// Court countdown for the TV screen. Staff start it from a court booking; the TV counts down
// to the end of the booking and sounds an alarm when time is up. One timer at a time
// (there is one court), kept in the settings table so no database migration is needed.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AdminError } from "./admin-ops";
import { formatMinute, todayInManila, utcToManila } from "./time";
import type { SessionUser } from "./auth";

const KEY = "court_timer";
/** After time is up, the TV keeps showing "Time's up" this long, then the timer clears itself. */
const SHOW_AFTER_END_MS = 15 * 60_000;
export const MAX_EXTRA_MINUTES = 120;

export type CourtTimer = { bookingId: string; label: string; endsAt: string; startedAt: string };

function parse(v: unknown): CourtTimer | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<CourtTimer>;
  if (typeof t.bookingId !== "string" || typeof t.endsAt !== "string" || Number.isNaN(Date.parse(t.endsAt))) return null;
  return { bookingId: t.bookingId, label: String(t.label ?? ""), endsAt: t.endsAt, startedAt: String(t.startedAt ?? t.endsAt) };
}

/** The running timer, or null (none, or it ended more than 15 minutes ago). */
export async function getCourtTimer(now = new Date()): Promise<CourtTimer | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const t = parse(row?.value);
  if (!t) return null;
  if (now.getTime() - Date.parse(t.endsAt) > SHOW_AFTER_END_MS) return null;
  return t;
}

async function save(t: CourtTimer | null) {
  const value = (t ?? {}) as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

const log = (action: string, entityId: string, user: SessionUser, details?: object) =>
  prisma.auditLog.create({ data: { action, entity: "booking", entityId, userId: user.id, details: (details ?? undefined) as Prisma.InputJsonValue | undefined } });

/** Starts the TV countdown to the end of this court booking (replaces any other timer). */
export async function startCourtTimer(bookingId: string, user: SessionUser, now = new Date()) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { amenity: true } });
  if (!b || b.kind !== "BOOKING") throw new AdminError("Booking not found.");
  if (b.amenity.type !== "COURT") throw new AdminError("The countdown is for court bookings only.");
  if (b.status !== "CONFIRMED" && b.status !== "CHECKED_IN") throw new AdminError("Only confirmed or checked-in bookings can use the countdown.");
  if (utcToManila(b.startAt).date !== todayInManila(now)) throw new AdminError("The countdown can only be started on the day of the booking.");
  if (b.endAt <= now) throw new AdminError("This booking has already ended.");
  const end = utcToManila(b.endAt);
  const t: CourtTimer = {
    bookingId: b.id,
    label: `${(b.customerName ?? "Court").split(" ")[0]} · until ${formatMinute(end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}`,
    endsAt: b.endAt.toISOString(),
    startedAt: now.toISOString(),
  };
  await save(t);
  await log("COURT_TIMER_STARTED", b.id, user);
  return t;
}

/** Adds minutes to the running timer (e.g. the group paid for extra time). */
export async function extendCourtTimer(minutes: number, user: SessionUser, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTRA_MINUTES) throw new AdminError("Choose between 1 and 120 minutes.");
  const t = await getCourtTimer(now);
  if (!t) throw new AdminError("No countdown is running.");
  // If time was already up, count the extra minutes from now.
  const base = Math.max(Date.parse(t.endsAt), now.getTime());
  const next: CourtTimer = { ...t, endsAt: new Date(base + minutes * 60_000).toISOString() };
  const end = utcToManila(new Date(next.endsAt));
  next.label = `${t.label.split(" · ")[0]} · until ${formatMinute(end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}`;
  await save(next);
  await log("COURT_TIMER_EXTENDED", t.bookingId, user, { minutes });
  return next;
}

export async function stopCourtTimer(user: SessionUser) {
  const t = await getCourtTimer();
  await save(null);
  if (t) await log("COURT_TIMER_STOPPED", t.bookingId, user);
}
