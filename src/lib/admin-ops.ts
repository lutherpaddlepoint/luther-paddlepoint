// Booking operations done by staff and the owner. Every change is written to the audit log.
import { Prisma, type Booking } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { expireStaleHolds, ACTIVE_STATUSES } from "./availability";
import { isOverlapError, newAccessToken, newReferenceCode, rulesOf } from "./bookings";
import { quoteCourt, quotePool, PricingError } from "./pricing";
import { rescheduleAmounts } from "./admin-core";
import { normalizeGcashRef } from "./payment-core";
import { normalizePhMobile } from "./phone";
import { formatMinute, manilaToUtc, todayInManila, utcToManila } from "./time";
import type { SessionUser } from "./auth";
import { notify } from "./notify";

type Tx = Prisma.TransactionClient;

export class AdminError extends Error {}

const audit = (tx: Tx, user: SessionUser, action: string, entityId: string, details?: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { action, entity: "booking", entityId, userId: user.id, details } });

const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

async function ensureInventory(sessionId: string, date: string, capacity: number) {
  await prisma.$executeRaw`
    INSERT INTO "pool_session_inventory" ("id", "pool_session_id", "date", "capacity", "reserved", "is_closed")
    VALUES (gen_random_uuid(), ${sessionId}::uuid, ${date}::date, ${capacity}, 0, false)
    ON CONFLICT ("pool_session_id", "date") DO NOTHING`;
  return prisma.poolSessionInventory.findUniqueOrThrow({
    where: { poolSessionId_date: { poolSessionId: sessionId, date: dateOnly(date) } },
  });
}

async function reserveSpots(tx: Tx, inventoryId: string, guests: number) {
  const [{ reserve_pool_spots: ok }] = await tx.$queryRaw<{ reserve_pool_spots: number | null }[]>`
    SELECT reserve_pool_spots(${inventoryId}::uuid, ${guests}::int)`;
  if (ok === null) {
    const inv = await tx.poolSessionInventory.findUniqueOrThrow({ where: { id: inventoryId } });
    throw new AdminError(inv.isClosed ? "The pool is closed for that session." : `Only ${Math.max(0, inv.capacity - inv.reserved)} spots left in that session.`);
  }
}

const releaseSpots = (tx: Tx, b: Booking) =>
  b.poolInventoryId
    ? tx.poolSessionInventory.update({ where: { id: b.poolInventoryId }, data: { reserved: { decrement: b.adults + b.kids } } })
    : Promise.resolve();

/** Lists active bookings that overlap a court time, for clear error messages. */
async function courtConflicts(amenityId: string, startAt: Date, endAt: Date, excludeId?: string) {
  const rows = await prisma.booking.findMany({
    where: {
      amenityId, exclusive: true, status: { in: [...ACTIVE_STATUSES] },
      startAt: { lt: endAt }, endAt: { gt: startAt }, ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { referenceCode: true, kind: true, customerName: true, startAt: true, endAt: true, notes: true },
  });
  return rows.map((r) => {
    const s = utcToManila(r.startAt).minuteOfDay;
    const e = utcToManila(r.endAt).minuteOfDay;
    const who = r.kind === "BLOCK" ? `block: ${r.notes ?? "closed"}` : `${r.referenceCode} ${r.customerName ?? ""}`.trim();
    return `${formatMinute(s)}–${formatMinute(e)} (${who})`;
  });
}

async function conflictMessage(amenityId: string, startAt: Date, endAt: Date, excludeId?: string) {
  const c = await courtConflicts(amenityId, startAt, endAt, excludeId);
  return c.length ? `That time overlaps: ${c.join("; ")}.` : "That time is no longer free.";
}

// ---------------------------------------------------------------------------
// Walk-ins and phone bookings made by staff
// ---------------------------------------------------------------------------
export type WalkInInput = {
  amenity: "COURT" | "POOL";
  date: string;
  startMinute?: number;
  endMinute?: number;
  players?: number;
  sessionId?: string;
  adults?: number;
  kids?: number;
  name: string;
  mobile?: string;
  paid: "FULL" | "FEE" | "NONE";
  method: "CASH" | "GCASH_MANUAL";
  gcashReference?: string;
  checkInNow: boolean;
};

export async function createWalkIn(input: WalkInInput, user: SessionUser) {
  const settings = await getSettings();
  const now = new Date();
  const name = input.name.trim();
  if (name.length < 2) throw new AdminError("Enter the customer's name.");
  const mobile = input.mobile?.trim() ? normalizePhMobile(input.mobile) : null;
  if (input.mobile?.trim() && !mobile) throw new AdminError("That mobile number doesn't look right (e.g. 0917 123 4567).");
  const gcashRef = input.method === "GCASH_MANUAL" && input.paid !== "NONE" ? normalizeGcashRef(input.gcashReference ?? "") : null;
  if (input.method === "GCASH_MANUAL" && input.paid !== "NONE" && !gcashRef) throw new AdminError("Enter the GCash Ref. No.");
  if (input.checkInNow && input.date !== todayInManila(now)) throw new AdminError("Only today's bookings can be checked in now.");

  await expireStaleHolds();
  const status = input.checkInNow ? ("CHECKED_IN" as const) : ("CONFIRMED" as const);

  const paymentsFor = (fee: number, balance: number) => {
    const p: Prisma.PaymentCreateWithoutBookingInput[] = [];
    const base = { method: input.method, status: "PAID" as const, paidAt: now, verifiedBy: { connect: { id: user.id } } };
    if (input.paid !== "NONE" && fee > 0) p.push({ ...base, type: "RESERVATION_FEE", amountCentavos: fee, gcashReference: gcashRef });
    if (input.paid === "FULL" && balance > 0) p.push({ ...base, type: "BALANCE", amountCentavos: balance });
    return p;
  };

  try {
    if (input.amenity === "COURT") {
      const court = await prisma.amenity.findFirst({ where: { type: "COURT", isActive: true } });
      if (!court) throw new AdminError("No active court.");
      const startMinute = input.startMinute ?? -1;
      const endMinute = input.endMinute ?? -1;
      const quote = quoteCourt({
        date: input.date, startMinute, endMinute, rules: await rulesOf(court.id),
        openMinute: settings.operating_hours.openMinute, closeMinute: settings.operating_hours.closeMinute,
        feePercent: settings.reservation_fee_percent, minHours: settings.court_min_hours,
      });
      const startAt = manilaToUtc(input.date, startMinute);
      const endAt = manilaToUtc(input.date, endMinute);
      if (endAt <= now) throw new AdminError("That time has already ended.");

      try {
        const b = await prisma.booking.create({
          data: {
            referenceCode: newReferenceCode(), accessToken: newAccessToken(), amenityId: court.id, exclusive: true,
            customerName: name, mobile, startAt, endAt, adults: input.players ?? 2,
            totalCentavos: quote.totalCentavos, reservationFeeCentavos: quote.reservationFeeCentavos, balanceCentavos: quote.balanceCentavos,
            status, source: "WALK_IN", createdById: user.id, checkedInAt: input.checkInNow ? now : null,
            lineItems: { create: quote.lineItems },
            payments: { create: paymentsFor(quote.reservationFeeCentavos, quote.balanceCentavos) },
          },
        });
        await prisma.$transaction((tx) => audit(tx, user, "WALK_IN_CREATED", b.id, { paid: input.paid, method: input.method }));
        return b;
      } catch (e) {
        if (isOverlapError(e)) throw new AdminError(await conflictMessage(court.id, startAt, endAt));
        throw e;
      }
    }

    const session = await prisma.poolSession.findFirst({ where: { id: input.sessionId, isActive: true }, include: { amenity: true } });
    if (!session) throw new AdminError("Choose a pool session.");
    const adults = input.adults ?? 0;
    const kids = input.kids ?? 0;
    const quote = quotePool({
      date: input.date, sessionStartMinute: session.startMinute, adults, kids,
      rules: await rulesOf(session.amenityId), feePercent: settings.reservation_fee_percent,
    });
    if (manilaToUtc(input.date, session.endMinute) <= now) throw new AdminError("That session has already ended.");
    const inv = await ensureInventory(session.id, input.date, session.amenity.capacity ?? 30);

    return await prisma.$transaction(async (tx) => {
      await reserveSpots(tx, inv.id, adults + kids);
      const b = await tx.booking.create({
        data: {
          referenceCode: newReferenceCode(), accessToken: newAccessToken(), amenityId: session.amenityId, exclusive: false,
          poolInventoryId: inv.id, customerName: name, mobile,
          startAt: manilaToUtc(input.date, session.startMinute), endAt: manilaToUtc(input.date, session.endMinute),
          adults, kids,
          totalCentavos: quote.totalCentavos, reservationFeeCentavos: quote.reservationFeeCentavos, balanceCentavos: quote.balanceCentavos,
          status, source: "WALK_IN", createdById: user.id, checkedInAt: input.checkInNow ? now : null,
          lineItems: { create: quote.lineItems },
          payments: { create: paymentsFor(quote.reservationFeeCentavos, quote.balanceCentavos) },
        },
      });
      await audit(tx, user, "WALK_IN_CREATED", b.id, { paid: input.paid, method: input.method });
      return b;
    });
  } catch (e) {
    if (e instanceof PricingError) throw new AdminError(e.message);
    if (String((e as Error).message).includes("payments_gcash_reference_unique"))
      throw new AdminError("That GCash Ref. No. was already used for another booking.");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Check-in, balance, no-show
// ---------------------------------------------------------------------------
export async function paidSoFar(bookingId: string, tx: Tx | typeof prisma = prisma) {
  const agg = await tx.payment.aggregate({ where: { bookingId, status: "PAID" }, _sum: { amountCentavos: true } });
  return agg._sum.amountCentavos ?? 0;
}

export async function recordBalance(
  bookingId: string,
  method: "CASH" | "GCASH_MANUAL",
  gcashReference: string | undefined,
  user: SessionUser,
  tx: Tx | null = null,
) {
  const run = async (t: Tx) => {
    const b = await t.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const due = b.totalCentavos - (await paidSoFar(b.id, t));
    if (due <= 0) return 0;
    const ref = method === "GCASH_MANUAL" ? normalizeGcashRef(gcashReference ?? "") : null;
    if (method === "GCASH_MANUAL" && !ref) throw new AdminError("Enter the GCash Ref. No. for the balance.");
    await t.payment.create({
      data: { bookingId, type: "BALANCE", method, amountCentavos: due, gcashReference: ref, status: "PAID", paidAt: new Date(), verifiedById: user.id },
    });
    await audit(t, user, "BALANCE_RECORDED", bookingId, { method, amountCentavos: due });
    return due;
  };
  try {
    return tx ? await run(tx) : await prisma.$transaction(run);
  } catch (e) {
    if (String((e as Error).message).includes("payments_gcash_reference_unique"))
      throw new AdminError("That GCash Ref. No. was already used.");
    throw e;
  }
}

export async function checkIn(bookingId: string, collect: "CASH" | "GCASH_MANUAL" | "LATER", gcashReference: string | undefined, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status === "CHECKED_IN") throw new AdminError("Already checked in.");
    if (b.status !== "CONFIRMED") throw new AdminError(`Can't check in a booking that is ${b.status.replace("_", " ").toLowerCase()}.`);
    const bookingDate = utcToManila(b.startAt).date;
    if (bookingDate !== todayInManila()) throw new AdminError(`This booking is for ${bookingDate}, not today.`);
    if (collect !== "LATER") await recordBalance(b.id, collect, gcashReference, user, tx);
    await tx.booking.update({ where: { id: b.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    await audit(tx, user, "CHECKED_IN", b.id, { collect });
  });
}

export async function markNoShow(bookingId: string, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== "CONFIRMED") throw new AdminError("Only confirmed bookings can be marked as no-show.");
    if (b.startAt > new Date()) throw new AdminError("The booking hasn't started yet.");
    await tx.booking.update({ where: { id: b.id }, data: { status: "NO_SHOW" } });
    await releaseSpots(tx, b); // frees pool spots for the rest of the session
    await audit(tx, user, "NO_SHOW", b.id);
  });
}

// ---------------------------------------------------------------------------
// Owner: cancel and reschedule
// ---------------------------------------------------------------------------
export async function cancelBooking(bookingId: string, reason: string, user: SessionUser) {
  if (reason.trim().length < 3) throw new AdminError("Give a reason for cancelling.");
  const kind = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!["HOLD", "PENDING_VERIFICATION", "CONFIRMED"].includes(b.status))
      throw new AdminError(`This booking is already ${b.status.replace("_", " ").toLowerCase()}.`);
    await tx.booking.update({
      where: { id: b.id },
      data: { status: "CANCELLED", notes: [b.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") },
    });
    await releaseSpots(tx, b);
    await audit(tx, user, b.kind === "BLOCK" ? "BLOCK_REMOVED" : "CANCELLED", b.id, { reason: reason.trim() });
    return b.kind;
  });
  if (kind === "BOOKING") await notify("CANCELLED", bookingId);
}

export type RescheduleInput = {
  date: string;
  startMinute?: number; // court
  endMinute?: number;
  sessionId?: string; // pool
  adults?: number;
  kids?: number;
  overridePolicy: boolean;
};

export async function rescheduleBooking(bookingId: string, input: RescheduleInput, user: SessionUser) {
  const settings = await getSettings();
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { amenity: true } });
  if (b.kind !== "BOOKING" || !["CONFIRMED", "PENDING_VERIFICATION"].includes(b.status))
    throw new AdminError("Only confirmed (or payment-pending) bookings can be rescheduled.");
  const policy = settings.reschedule_policy;
  if (b.rescheduleCount >= policy.maxTimes) throw new AdminError(`This booking was already rescheduled ${b.rescheduleCount} time(s), the maximum.`);
  const hoursBefore = (b.startAt.getTime() - Date.now()) / 3_600_000;
  if (hoursBefore < policy.minHoursBefore && !input.overridePolicy)
    throw new AdminError(`The policy needs at least ${policy.minHoursBefore} hours' notice (this one is ${Math.max(0, Math.floor(hoursBefore))}h). Tick "Allow anyway" to override.`);

  const old = { startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), adults: b.adults, kids: b.kids, total: b.totalCentavos };

  try {
    if (b.amenity.type === "COURT") {
      const quote = quoteCourt({
        date: input.date, startMinute: input.startMinute ?? -1, endMinute: input.endMinute ?? -1,
        rules: await rulesOf(b.amenityId), openMinute: settings.operating_hours.openMinute,
        closeMinute: settings.operating_hours.closeMinute, feePercent: settings.reservation_fee_percent, minHours: settings.court_min_hours,
      });
      const startAt = manilaToUtc(input.date, input.startMinute!);
      const endAt = manilaToUtc(input.date, input.endMinute!);
      if (startAt <= new Date()) throw new AdminError("Choose a time in the future.");
      const money = rescheduleAmounts(quote.totalCentavos, b.reservationFeeCentavos);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.bookingLineItem.deleteMany({ where: { bookingId: b.id } });
          await tx.booking.update({
            where: { id: b.id },
            data: { startAt, endAt, ...money, rescheduleCount: { increment: 1 }, lineItems: { create: quote.lineItems } },
          });
          await audit(tx, user, "RESCHEDULED", b.id, { from: old, override: input.overridePolicy });
        });
      } catch (e) {
        if (isOverlapError(e)) throw new AdminError(await conflictMessage(b.amenityId, startAt, endAt, b.id));
        throw e;
      }
      await notify("RESCHEDULED", b.id);
      return;
    }

    // Pool
    const session = await prisma.poolSession.findFirst({ where: { id: input.sessionId, amenityId: b.amenityId, isActive: true } });
    if (!session) throw new AdminError("Choose a pool session.");
    const adults = input.adults ?? b.adults;
    const kids = input.kids ?? b.kids;
    const quote = quotePool({
      date: input.date, sessionStartMinute: session.startMinute, adults, kids,
      rules: await rulesOf(b.amenityId), feePercent: settings.reservation_fee_percent,
    });
    if (manilaToUtc(input.date, session.endMinute) <= new Date()) throw new AdminError("That session has already ended.");
    const inv = await ensureInventory(session.id, input.date, b.amenity.capacity ?? 30);
    const money = rescheduleAmounts(quote.totalCentavos, b.reservationFeeCentavos);

    await prisma.$transaction(async (tx) => {
      await releaseSpots(tx, b); // give back the old spots first (matters when moving within the same session)
      await reserveSpots(tx, inv.id, adults + kids);
      await tx.bookingLineItem.deleteMany({ where: { bookingId: b.id } });
      await tx.booking.update({
        where: { id: b.id },
        data: {
          poolInventory: { connect: { id: inv.id } },
          startAt: manilaToUtc(input.date, session.startMinute), endAt: manilaToUtc(input.date, session.endMinute),
          adults, kids, ...money, rescheduleCount: { increment: 1 }, lineItems: { create: quote.lineItems },
        },
      });
      await audit(tx, user, "RESCHEDULED", b.id, { from: old, override: input.overridePolicy });
    });
    await notify("RESCHEDULED", b.id);
  } catch (e) {
    if (e instanceof PricingError) throw new AdminError(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Owner: blocks and pool closures
// ---------------------------------------------------------------------------
export async function createCourtBlock(date: string, startMinute: number, endMinute: number, reason: string, user: SessionUser) {
  const settings = await getSettings();
  const { openMinute, closeMinute } = settings.operating_hours;
  if (reason.trim().length < 2) throw new AdminError("Give a reason (e.g. maintenance, tournament).");
  if (startMinute % 60 || endMinute % 60) throw new AdminError("Blocks start and end on the hour.");
  if (endMinute <= startMinute) throw new AdminError("End time must be after start time.");
  if (startMinute < openMinute || endMinute > closeMinute) throw new AdminError("Block must be within opening hours.");
  const court = await prisma.amenity.findFirst({ where: { type: "COURT", isActive: true } });
  if (!court) throw new AdminError("No active court.");
  const startAt = manilaToUtc(date, startMinute);
  const endAt = manilaToUtc(date, endMinute);
  await expireStaleHolds();
  try {
    const b = await prisma.booking.create({
      data: {
        referenceCode: newReferenceCode(), accessToken: newAccessToken(), amenityId: court.id, kind: "BLOCK",
        exclusive: true, startAt, endAt, status: "CONFIRMED", notes: reason.trim(), createdById: user.id,
      },
    });
    await prisma.$transaction((tx) => audit(tx, user, "BLOCK_CREATED", b.id, { reason: reason.trim() }));
  } catch (e) {
    if (isOverlapError(e)) throw new AdminError(`${await conflictMessage(court.id, startAt, endAt)} Move or cancel those first.`);
    throw e;
  }
}

/** Close or reopen a pool session for one date. Returns bookings that are affected by a closure. */
export async function setPoolClosed(sessionId: string, date: string, closed: boolean, reason: string, user: SessionUser) {
  if (closed && reason.trim().length < 2) throw new AdminError("Give a reason for closing.");
  const session = await prisma.poolSession.findUniqueOrThrow({ where: { id: sessionId }, include: { amenity: true } });
  const inv = await ensureInventory(session.id, date, session.amenity.capacity ?? 30);
  await prisma.$transaction(async (tx) => {
    await tx.poolSessionInventory.update({ where: { id: inv.id }, data: { isClosed: closed, closedReason: closed ? reason.trim() : null } });
    await tx.auditLog.create({
      data: { action: closed ? "POOL_CLOSED" : "POOL_REOPENED", entity: "pool_session_inventory", entityId: inv.id, userId: user.id, details: { date, session: session.name, reason } },
    });
  });
  if (!closed) return [];
  return prisma.booking.findMany({
    where: { poolInventoryId: inv.id, status: { in: [...ACTIVE_STATUSES] } },
    select: { id: true, referenceCode: true, customerName: true, mobile: true, adults: true, kids: true },
  });
}

export async function resolveAttention(bookingId: string, note: string, user: SessionUser) {
  if (note.trim().length < 3) throw new AdminError("Write what was done (e.g. moved to Oct 14, 7 PM).");
  await prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await tx.booking.update({
      where: { id: b.id },
      data: { attentionReason: null, notes: [b.notes, `Resolved: ${note.trim()}`].filter(Boolean).join("\n") },
    });
    await audit(tx, user, "ATTENTION_RESOLVED", b.id, { was: b.attentionReason, note: note.trim() });
  });
}

export async function addNote(bookingId: string, note: string, user: SessionUser) {
  if (!note.trim()) throw new AdminError("Write a note first.");
  await prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await tx.booking.update({ where: { id: b.id }, data: { notes: [b.notes, `${user.name}: ${note.trim()}`].filter(Boolean).join("\n") } });
    await audit(tx, user, "NOTE_ADDED", b.id);
  });
}
