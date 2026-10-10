import { randomBytes, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { bookingWindow, expireStaleHolds } from "./availability";
import { quoteCourt, quotePool, PricingError, type RateRuleInput } from "./pricing";
import { manilaToUtc } from "./time";
import type { CreateBookingInput } from "./validation";

export class BookingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newReferenceCode = () =>
  "LPP-" + Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
export const newAccessToken = () => randomBytes(24).toString("base64url");

export const isOverlapError = (e: unknown) =>
  String((e as Error)?.message ?? "").includes("bookings_no_overlap") ||
  String((e as Error)?.message ?? "").includes("23P01");

const isReferenceCollision = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === "P2002" &&
  JSON.stringify(e.meta ?? {}).includes("reference_code");

/** Retries the insert if the random reference code happens to already exist. */
async function withUniqueCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(newReferenceCode());
    } catch (e) {
      if (attempt < 4 && isReferenceCollision(e)) continue;
      throw e;
    }
  }
}

export const rulesOf = (amenityId: string) =>
  prisma.rateRule
    .findMany({ where: { amenityId, isActive: true } })
    .then((rows) => rows.map<RateRuleInput>((r) => ({ ...r, guestType: r.guestType })));

/**
 * Places a temporary HOLD on the chosen court hours or pool spots.
 * The price is always recomputed here — prices sent by the browser are never trusted.
 */
export async function createHold(input: CreateBookingInput, now = new Date()) {
  const settings = await getSettings();
  const { firstDate, lastDate } = bookingWindow(settings.booking_window_days, now);
  if (input.date < firstDate || input.date > lastDate)
    throw new BookingError(`You can book from today up to ${settings.booking_window_days} days ahead.`);

  await expireStaleHolds();

  const holdExpiresAt = new Date(now.getTime() + settings.hold_minutes[settings.payment_mode] * 60_000);
  const customer = {
    customerName: input.name,
    mobile: input.mobile,
    email: input.email,
    agreedToPolicyAt: now,
    status: "HOLD" as const,
    source: "ONLINE" as const,
    holdExpiresAt,
  };

  try {
    if (input.amenity === "COURT") {
      const court = await prisma.amenity.findFirst({ where: { id: input.amenityId, type: "COURT", isActive: true } });
      if (!court) throw new BookingError("This court is not available for booking.");

      const quote = quoteCourt({
        date: input.date, startMinute: input.startMinute, endMinute: input.endMinute,
        rules: await rulesOf(court.id),
        openMinute: settings.operating_hours.openMinute, closeMinute: settings.operating_hours.closeMinute,
        feePercent: settings.reservation_fee_percent, minHours: settings.court_min_hours,
      });
      const startAt = manilaToUtc(input.date, input.startMinute);
      if (startAt <= now) throw new BookingError("That time has already started. Please pick a later slot.");

      return await withUniqueCode((referenceCode) =>
        prisma.booking.create({
          data: {
            referenceCode, accessToken: newAccessToken(), amenityId: court.id, exclusive: true,
            startAt, endAt: manilaToUtc(input.date, input.endMinute), adults: input.players,
            totalCentavos: quote.totalCentavos,
            reservationFeeCentavos: quote.reservationFeeCentavos,
            balanceCentavos: quote.balanceCentavos,
            lineItems: { create: quote.lineItems },
            ...customer,
          },
          select: { referenceCode: true, accessToken: true },
        }),
      );
    }

    // ---- POOL
    const session = await prisma.poolSession.findFirst({
      where: { id: input.sessionId, isActive: true },
      include: { amenity: true },
    });
    if (!session || !session.amenity.isActive) throw new BookingError("This pool session is not available.");

    const guests = input.adults + input.kids;
    const lastBookable = manilaToUtc(input.date, session.endMinute - settings.pool_booking_cutoff_minutes);
    if (now >= lastBookable) throw new BookingError("Online booking for this session has closed.");

    const quote = quotePool({
      date: input.date, sessionStartMinute: session.startMinute, adults: input.adults, kids: input.kids,
      rules: await rulesOf(session.amenityId), feePercent: settings.reservation_fee_percent,
    });

    const capacity = session.amenity.capacity ?? 30;
    // Make sure the inventory row for this date exists (safe if two requests race).
    await prisma.$executeRaw`
      INSERT INTO "pool_session_inventory" ("id", "pool_session_id", "date", "capacity", "reserved", "is_closed")
      VALUES (gen_random_uuid(), ${session.id}::uuid, ${input.date}::date, ${capacity}, 0, false)
      ON CONFLICT ("pool_session_id", "date") DO NOTHING`;

    return await prisma.$transaction(async (tx) => {
      const inv = await tx.poolSessionInventory.findUniqueOrThrow({
        where: { poolSessionId_date: { poolSessionId: session.id, date: new Date(`${input.date}T00:00:00Z`) } },
      });
      const [{ reserve_pool_spots: reserved }] = await tx.$queryRaw<{ reserve_pool_spots: number | null }[]>`
        SELECT reserve_pool_spots(${inv.id}::uuid, ${guests}::int)`;

      if (reserved === null) {
        const fresh = await tx.poolSessionInventory.findUniqueOrThrow({ where: { id: inv.id } }); // fresh numbers
        if (fresh.isClosed) throw new BookingError("The pool is closed for this session.", 409);
        const left = Math.max(0, fresh.capacity - fresh.reserved);
        throw new BookingError(
          left === 0 ? "This session is already full." : `Only ${left} spot${left === 1 ? "" : "s"} left in this session.`,
          409,
        );
      }

      // Reference collisions inside a transaction abort it, so the code is checked first.
      let referenceCode = newReferenceCode();
      while (await tx.booking.findUnique({ where: { referenceCode }, select: { id: true } })) referenceCode = newReferenceCode();

      return tx.booking.create({
        data: {
          referenceCode, accessToken: newAccessToken(), amenityId: session.amenityId, exclusive: false,
          poolInventoryId: inv.id,
          startAt: manilaToUtc(input.date, session.startMinute), endAt: manilaToUtc(input.date, session.endMinute),
          adults: input.adults, kids: input.kids,
          totalCentavos: quote.totalCentavos,
          reservationFeeCentavos: quote.reservationFeeCentavos,
          balanceCentavos: quote.balanceCentavos,
          lineItems: { create: quote.lineItems },
          ...customer,
        },
        select: { referenceCode: true, accessToken: true },
      });
    });
  } catch (e) {
    if (e instanceof BookingError) throw e;
    if (e instanceof PricingError) throw new BookingError(e.message);
    if (isOverlapError(e))
      throw new BookingError("Someone just booked part of that time. Please choose another slot.", 409);
    throw e;
  }
}
