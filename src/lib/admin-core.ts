// Pure helpers for the admin dashboard (money on reschedule, reports). No database.
import { utcToManila } from "./time";

/** After rescheduling, the paid reservation fee stays; the balance is recalculated. */
export function rescheduleAmounts(newTotalCentavos: number, reservationFeeCentavos: number) {
  const balanceCentavos = Math.max(0, newTotalCentavos - reservationFeeCentavos);
  return { reservationFeeCentavos, balanceCentavos, totalCentavos: reservationFeeCentavos + balanceCentavos };
}

export type ReportBooking = {
  amenityType: "COURT" | "POOL";
  kind: "BOOKING" | "BLOCK";
  status: string;
  source: "ONLINE" | "WALK_IN";
  startAt: Date;
  endAt: Date;
  totalCentavos: number;
  adults: number;
  kids: number;
  lineItems: { description: string; amountCentavos: number }[];
};

export type ReportPayment = { method: "GCASH_MANUAL" | "GCASH_PAYMONGO" | "CASH"; amountCentavos: number; paidAt: Date; amenityType: "COURT" | "POOL" };

export const USED_STATUSES = ["CONFIRMED", "CHECKED_IN", "COMPLETED"];

export type Report = ReturnType<typeof buildReport>;

/** Everything on the Reports page, from raw rows. Dates are Manila "YYYY-MM-DD" (inclusive). */
export function buildReport(args: {
  from: string;
  to: string;
  days: string[]; // every date in the range
  bookings: ReportBooking[];
  payments: ReportPayment[];
  openMinute: number;
  closeMinute: number;
  lightsOnMinute: number;
  courtCount?: number; // number of courts (open hours count once per court)
}) {
  const { bookings, payments, days, openMinute, closeMinute, lightsOnMinute } = args;
  const courtCount = Math.max(1, args.courtCount ?? 1);
  const used = bookings.filter((b) => b.kind === "BOOKING" && USED_STATUSES.includes(b.status));
  const blocks = bookings.filter((b) => b.kind === "BLOCK" && b.status === "CONFIRMED");
  const hours = (b: { startAt: Date; endAt: Date }) => (b.endAt.getTime() - b.startAt.getTime()) / 3_600_000;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const court = used.filter((b) => b.amenityType === "COURT");
  const pool = used.filter((b) => b.amenityType === "POOL");

  const courtNight = sum(court.flatMap((b) => b.lineItems.filter((li) => /^night/i.test(li.description)).map((li) => li.amountCentavos)));
  const courtValue = sum(court.map((b) => b.totalCentavos));
  const isNightPool = (b: ReportBooking) => utcToManila(b.startAt).minuteOfDay >= lightsOnMinute;
  const poolNight = sum(pool.filter(isNightPool).map((b) => b.totalCentavos));
  const poolValue = sum(pool.map((b) => b.totalCentavos));

  const openHoursPerDay = (closeMinute - openMinute) / 60;
  const blockedHours = sum(blocks.filter((b) => b.amenityType === "COURT").map(hours));
  const courtHoursAvailable = Math.max(0, days.length * openHoursPerDay * courtCount - blockedHours);
  const courtHoursBooked = sum(court.map(hours));

  const collected = {
    total: sum(payments.map((p) => p.amountCentavos)),
    cash: sum(payments.filter((p) => p.method === "CASH").map((p) => p.amountCentavos)),
    gcash: sum(payments.filter((p) => p.method !== "CASH").map((p) => p.amountCentavos)),
    court: sum(payments.filter((p) => p.amenityType === "COURT").map((p) => p.amountCentavos)),
    pool: sum(payments.filter((p) => p.amenityType === "POOL").map((p) => p.amountCentavos)),
  };

  const byDay = days.map((date) => {
    const dayBookings = used.filter((b) => utcToManila(b.startAt).date === date);
    return {
      date,
      bookings: dayBookings.length,
      value: sum(dayBookings.map((b) => b.totalCentavos)),
      collected: sum(payments.filter((p) => utcToManila(p.paidAt).date === date).map((p) => p.amountCentavos)),
      courtHours: sum(dayBookings.filter((b) => b.amenityType === "COURT").map(hours)),
      poolGuests: sum(dayBookings.filter((b) => b.amenityType === "POOL").map((b) => b.adults + b.kids)),
    };
  });

  // Court bookings per hour of day (each booked hour counts once)
  const peakHours = new Map<number, number>();
  for (let m = openMinute; m < closeMinute; m += 60) peakHours.set(m, 0);
  for (const b of court) {
    const start = utcToManila(b.startAt).minuteOfDay;
    for (let m = start; m < start + hours(b) * 60; m += 60) peakHours.set(m, (peakHours.get(m) ?? 0) + 1);
  }
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  for (const b of used) weekday[utcToManila(b.startAt).dayOfWeek] += 1;

  return {
    from: args.from,
    to: args.to,
    bookingsCount: used.length,
    walkIns: used.filter((b) => b.source === "WALK_IN").length,
    noShows: bookings.filter((b) => b.status === "NO_SHOW").length,
    cancelled: bookings.filter((b) => b.kind === "BOOKING" && b.status === "CANCELLED").length,
    value: { total: courtValue + poolValue, court: courtValue, pool: poolValue,
      courtDay: courtValue - courtNight, courtNight, poolDay: poolValue - poolNight, poolNight },
    collected,
    court: {
      bookings: court.length,
      hoursBooked: courtHoursBooked,
      hoursAvailable: courtHoursAvailable,
      occupancy: courtHoursAvailable ? courtHoursBooked / courtHoursAvailable : 0,
    },
    pool: {
      bookings: pool.length,
      adults: sum(pool.map((b) => b.adults)),
      kids: sum(pool.map((b) => b.kids)),
      dayGuests: sum(pool.filter((b) => !isNightPool(b)).map((b) => b.adults + b.kids)),
      nightGuests: sum(pool.filter(isNightPool).map((b) => b.adults + b.kids)),
    },
    byDay,
    peakHours: [...peakHours.entries()].map(([minute, count]) => ({ minute, count })),
    byWeekday: weekday,
  };
}

/** CSV cell escaping (Excel-safe, and blocks formula injection like "=HYPERLINK(...)"). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
