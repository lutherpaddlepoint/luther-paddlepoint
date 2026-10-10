// Read-only data for the dashboard pages.
import type { BookingStatus } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { expireStaleHolds } from "./availability";
import { buildReport, type ReportBooking } from "./admin-core";
import { addDays, dayOfWeek, formatMinute, manilaToUtc, utcToManila } from "./time";

const SHOWN: BookingStatus[] = ["HOLD", "PENDING_VERIFICATION", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"];

export type DayBooking = {
  id: string;
  referenceCode: string;
  kind: "BOOKING" | "BLOCK";
  status: BookingStatus;
  source: "ONLINE" | "WALK_IN";
  customerName: string | null;
  mobile: string | null;
  notes: string | null;
  startMinute: number;
  endMinute: number;
  adults: number;
  kids: number;
  totalCentavos: number;
  paidCentavos: number;
  attention: boolean;
};

const toDayBooking = (b: {
  id: string; referenceCode: string; kind: "BOOKING" | "BLOCK"; status: BookingStatus; source: "ONLINE" | "WALK_IN";
  customerName: string | null; mobile: string | null; notes: string | null; startAt: Date; endAt: Date;
  adults: number; kids: number; totalCentavos: number; attentionReason: string | null;
  payments: { amountCentavos: number }[];
}): DayBooking => {
  const end = utcToManila(b.endAt).minuteOfDay;
  return {
    id: b.id, referenceCode: b.referenceCode, kind: b.kind, status: b.status, source: b.source,
    customerName: b.customerName, mobile: b.mobile, notes: b.notes,
    startMinute: utcToManila(b.startAt).minuteOfDay, endMinute: end === 0 ? 1440 : end,
    adults: b.adults, kids: b.kids, totalCentavos: b.totalCentavos,
    paidCentavos: b.payments.reduce((s, p) => s + p.amountCentavos, 0),
    attention: !!b.attentionReason,
  };
};

const bookingSelect = {
  id: true, referenceCode: true, kind: true, status: true, source: true, customerName: true, mobile: true, notes: true,
  startAt: true, endAt: true, adults: true, kids: true, totalCentavos: true, attentionReason: true, amenityId: true,
  poolInventoryId: true,
  payments: { where: { status: "PAID" as const }, select: { amountCentavos: true } },
};

export async function attentionCounts() {
  const [pendingPayments, attention] = await Promise.all([
    prisma.payment.count({ where: { status: "PENDING", method: "GCASH_MANUAL" } }),
    prisma.booking.count({ where: { attentionReason: { not: null } } }),
  ]);
  return { pendingPayments, attention };
}

export type CourtRow =
  | { type: "free"; startMinute: number; endMinute: number; isNight: boolean }
  | { type: "booking"; startMinute: number; endMinute: number; isNight: boolean; booking: DayBooking };

export async function dayView(date: string) {
  await expireStaleHolds();
  const settings = await getSettings();
  const { openMinute, closeMinute } = settings.operating_hours;
  const dayStart = manilaToUtc(date, 0);
  const dayEnd = manilaToUtc(date, 1440);

  const [court, pool] = await Promise.all([
    prisma.amenity.findFirst({ where: { type: "COURT", isActive: true } }),
    prisma.amenity.findFirst({ where: { type: "POOL", isActive: true }, include: { poolSessions: { where: { isActive: true }, orderBy: { startMinute: "asc" } } } }),
  ]);

  const courtBookings = court
    ? (await prisma.booking.findMany({
        where: { amenityId: court.id, status: { in: SHOWN }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        orderBy: { startAt: "asc" }, select: bookingSelect,
      })).map(toDayBooking)
    : [];

  const rows: CourtRow[] = [];
  for (let m = openMinute; m < closeMinute; ) {
    const isNight = m >= settings.lights_on_minute;
    const b = courtBookings.find((x) => x.startMinute <= m && x.endMinute > m && x.status !== "NO_SHOW")
      ?? courtBookings.find((x) => x.startMinute <= m && x.endMinute > m);
    if (b) {
      const end = Math.min(b.endMinute, closeMinute);
      rows.push({ type: "booking", startMinute: m, endMinute: end, isNight, booking: b });
      m = end;
    } else {
      rows.push({ type: "free", startMinute: m, endMinute: m + 60, isNight });
      m += 60;
    }
  }

  const sessions = pool
    ? await Promise.all(
        pool.poolSessions.map(async (s) => {
          const inv = await prisma.poolSessionInventory.findUnique({
            where: { poolSessionId_date: { poolSessionId: s.id, date: new Date(`${date}T00:00:00Z`) } },
          });
          const bookings = inv
            ? (await prisma.booking.findMany({
                where: { poolInventoryId: inv.id, status: { in: SHOWN } }, orderBy: { createdAt: "asc" }, select: bookingSelect,
              })).map(toDayBooking)
            : [];
          return {
            id: s.id, name: s.name, startMinute: s.startMinute, endMinute: s.endMinute,
            capacity: inv?.capacity ?? pool.capacity ?? 30, reserved: inv?.reserved ?? 0,
            isClosed: inv?.isClosed ?? false, closedReason: inv?.closedReason ?? null, bookings,
          };
        }),
      )
    : [];

  const all = [...courtBookings, ...sessions.flatMap((s) => s.bookings)].filter((b) => b.kind === "BOOKING");
  const counted = all.filter((b) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status));
  const openHours = (closeMinute - openMinute) / 60;
  const blockedHours = courtBookings.filter((b) => b.kind === "BLOCK").reduce((s, b) => s + (b.endMinute - b.startMinute) / 60, 0);
  const bookedHours = courtBookings
    .filter((b) => b.kind === "BOOKING" && ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status))
    .reduce((s, b) => s + (b.endMinute - b.startMinute) / 60, 0);

  return {
    date, openMinute, closeMinute, lightsOnMinute: settings.lights_on_minute,
    courtId: court?.id ?? null, rows, sessions,
    totals: {
      bookings: counted.length,
      expectedCentavos: counted.reduce((s, b) => s + b.totalCentavos, 0),
      balanceDueCentavos: counted.reduce((s, b) => s + Math.max(0, b.totalCentavos - b.paidCentavos), 0),
      courtOccupancy: openHours - blockedHours > 0 ? bookedHours / (openHours - blockedHours) : 0,
      courtBookedHours: bookedHours,
      poolGuests: sessions.map((s) => ({ name: s.name, reserved: s.reserved, capacity: s.capacity })),
      waitingPayment: all.filter((b) => b.status === "PENDING_VERIFICATION").length,
    },
  };
}

export async function collectedOn(date: string) {
  const agg = await prisma.payment.groupBy({
    by: ["method"],
    where: { status: "PAID", paidAt: { gte: manilaToUtc(date, 0), lt: manilaToUtc(date, 1440) } },
    _sum: { amountCentavos: true },
  });
  const get = (m: string) => agg.find((a) => a.method === m)?._sum.amountCentavos ?? 0;
  const cash = get("CASH");
  const gcash = get("GCASH_MANUAL") + get("GCASH_PAYMONGO");
  return { cash, gcash, total: cash + gcash };
}

/** 7 days starting at `start`: court hour grid + pool occupancy per session. */
export async function weekView(start: string) {
  await expireStaleHolds();
  const settings = await getSettings();
  const { openMinute, closeMinute } = settings.operating_hours;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rangeStart = manilaToUtc(days[0], 0);
  const rangeEnd = manilaToUtc(days[6], 1440);
  const [court, pool] = await Promise.all([
    prisma.amenity.findFirst({ where: { type: "COURT", isActive: true } }),
    prisma.amenity.findFirst({ where: { type: "POOL", isActive: true }, include: { poolSessions: { where: { isActive: true }, orderBy: { startMinute: "asc" } } } }),
  ]);
  const bookings = court
    ? await prisma.booking.findMany({
        where: { amenityId: court.id, status: { in: SHOWN }, startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
        select: { id: true, kind: true, status: true, customerName: true, notes: true, startAt: true, endAt: true },
      })
    : [];
  const hours: number[] = [];
  for (let m = openMinute; m < closeMinute; m += 60) hours.push(m);

  const grid = hours.map((m) => ({
    minute: m,
    label: formatMinute(m),
    isNight: m >= settings.lights_on_minute,
    cells: days.map((d) => {
      const s = manilaToUtc(d, m);
      const e = manilaToUtc(d, m + 60);
      const b = bookings.find((x) => x.startAt < e && x.endAt > s && x.status !== "NO_SHOW");
      return b ? { id: b.id, kind: b.kind, status: b.status, label: b.kind === "BLOCK" ? b.notes ?? "Closed" : b.customerName ?? "" } : null;
    }),
  }));

  const inventory = pool
    ? await prisma.poolSessionInventory.findMany({
        where: { poolSessionId: { in: pool.poolSessions.map((s) => s.id) }, date: { gte: new Date(`${days[0]}T00:00:00Z`), lte: new Date(`${days[6]}T00:00:00Z`) } },
      })
    : [];
  const poolRows = (pool?.poolSessions ?? []).map((s) => ({
    name: s.name,
    cells: days.map((d) => {
      const inv = inventory.find((i) => i.poolSessionId === s.id && i.date.toISOString().slice(0, 10) === d);
      return { reserved: inv?.reserved ?? 0, capacity: inv?.capacity ?? pool?.capacity ?? 30, closed: inv?.isClosed ?? false };
    }),
  }));

  return { days, dows: days.map(dayOfWeek), grid, poolRows };
}

export function bookingDetail(id: string) {
  return prisma.booking.findUnique({
    where: { id },
    include: {
      amenity: true,
      lineItems: true,
      payments: { orderBy: { createdAt: "asc" }, include: { verifiedBy: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      poolInventory: { include: { poolSession: true } },
      notifications: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function bookingHistory(id: string) {
  return prisma.auditLog.findMany({ where: { entity: "booking", entityId: id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } });
}

export async function reportData(from: string, to: string) {
  const settings = await getSettings();
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 370; d = addDays(d, 1)) days.push(d);
  const start = manilaToUtc(from, 0);
  const end = manilaToUtc(to, 1440);

  const [bookings, payments] = await Promise.all([
    prisma.booking.findMany({
      where: { startAt: { gte: start, lt: end }, status: { notIn: ["HOLD", "EXPIRED", "REJECTED", "PENDING_VERIFICATION"] } },
      include: { amenity: { select: { type: true } }, lineItems: { select: { description: true, amountCentavos: true } } },
    }),
    prisma.payment.findMany({
      where: { status: "PAID", paidAt: { gte: start, lt: end } },
      include: { booking: { include: { amenity: { select: { type: true } } } } },
    }),
  ]);

  return buildReport({
    from, to, days,
    openMinute: settings.operating_hours.openMinute,
    closeMinute: settings.operating_hours.closeMinute,
    lightsOnMinute: settings.lights_on_minute,
    bookings: bookings.map<ReportBooking>((b) => ({
      amenityType: b.amenity.type, kind: b.kind, status: b.status, source: b.source, startAt: b.startAt, endAt: b.endAt,
      totalCentavos: b.totalCentavos, adults: b.adults, kids: b.kids, lineItems: b.lineItems,
    })),
    payments: payments.map((p) => ({ method: p.method, amountCentavos: p.amountCentavos, paidAt: p.paidAt!, amenityType: p.booking.amenity.type })),
  });
}
