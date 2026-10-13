// Court countdown for the TV screen. Staff start it from a court booking; the TV counts down
// to the end of the booking and sounds an alarm when time is up. One timer per court,
// kept in the settings table (key "court_timer:<court id>").
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AdminError } from "./admin-ops";
import { formatMinute, todayInManila, utcToManila } from "./time";
import type { SessionUser } from "./auth";

/** Before there were two courts there was one timer under this key; it is read as the first court's. */
const LEGACY_KEY = "court_timer";
const keyFor = (courtId: string) => `court_timer:${courtId}`;
/** After time is up, the TV keeps showing "Time's up" this long, then the timer clears itself. */
const SHOW_AFTER_END_MS = 15 * 60_000;
export const MAX_EXTRA_MINUTES = 120;

export type CourtTimer = { courtId: string; bookingId: string; label: string; endsAt: string; startedAt: string };

function parse(v: unknown, courtId: string): CourtTimer | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<CourtTimer>;
  if (typeof t.bookingId !== "string" || typeof t.endsAt !== "string" || Number.isNaN(Date.parse(t.endsAt))) return null;
  return { courtId, bookingId: t.bookingId, label: String(t.label ?? ""), endsAt: t.endsAt, startedAt: String(t.startedAt ?? t.endsAt) };
}

const fresh = (t: CourtTimer | null, now: Date) => (t && now.getTime() - Date.parse(t.endsAt) <= SHOW_AFTER_END_MS ? t : null);

/** The running timer on a court, or null (none, or it ended more than 15 minutes ago). */
export async function getCourtTimer(courtId: string, now = new Date()): Promise<CourtTimer | null> {
  const row = await prisma.setting.findUnique({ where: { key: keyFor(courtId) } });
  const t = fresh(parse(row?.value, courtId), now);
  if (t || row) return t;
  // An old single timer (from before per-court timers) belongs to whichever court its booking is on.
  const legacy = await prisma.setting.findUnique({ where: { key: LEGACY_KEY } });
  const lt = parse(legacy?.value, courtId);
  if (!lt) return null;
  const b = await prisma.booking.findUnique({ where: { id: lt.bookingId }, select: { amenityId: true } });
  return b?.amenityId === courtId ? fresh(lt, now) : null;
}

async function save(courtId: string, t: Omit<CourtTimer, "courtId"> | null) {
  const key = keyFor(courtId);
  const value = (t ?? {}) as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  await prisma.setting.deleteMany({ where: { key: LEGACY_KEY } });
}

const log = (action: string, entityId: string, user: SessionUser, details?: object) =>
  prisma.auditLog.create({ data: { action, entity: "booking", entityId, userId: user.id, details: (details ?? undefined) as Prisma.InputJsonValue | undefined } });

/** Starts the TV countdown to the end of this court booking (replaces that court's running timer). */
export async function startCourtTimer(bookingId: string, user: SessionUser, now = new Date()) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { amenity: true } });
  if (!b || b.kind !== "BOOKING") throw new AdminError("Booking not found.");
  if (b.amenity.type !== "COURT") throw new AdminError("The countdown is for court bookings only.");
  if (b.status !== "CONFIRMED" && b.status !== "CHECKED_IN") throw new AdminError("Only confirmed or checked-in bookings can use the countdown.");
  if (utcToManila(b.startAt).date !== todayInManila(now)) throw new AdminError("The countdown can only be started on the day of the booking.");
  if (b.endAt <= now) throw new AdminError("This booking has already ended.");
  const end = utcToManila(b.endAt);
  const t: CourtTimer = {
    courtId: b.amenityId,
    bookingId: b.id,
    label: `${(b.customerName ?? "Court").split(" ")[0]} · until ${formatMinute(end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}`,
    endsAt: b.endAt.toISOString(),
    startedAt: now.toISOString(),
  };
  await save(b.amenityId, t);
  await log("COURT_TIMER_STARTED", b.id, user);
  return t;
}

/** Adds minutes to the running timer (e.g. the group paid for extra time). */
export async function extendCourtTimer(courtId: string, minutes: number, user: SessionUser, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTRA_MINUTES) throw new AdminError("Choose between 1 and 120 minutes.");
  const t = await getCourtTimer(courtId, now);
  if (!t) throw new AdminError("No countdown is running.");
  // If time was already up, count the extra minutes from now.
  const base = Math.max(Date.parse(t.endsAt), now.getTime());
  const next: CourtTimer = { ...t, endsAt: new Date(base + minutes * 60_000).toISOString() };
  const end = utcToManila(new Date(next.endsAt));
  next.label = `${t.label.split(" · ")[0]} · until ${formatMinute(end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}`;
  await save(courtId, next);
  await log("COURT_TIMER_EXTENDED", t.bookingId, user, { minutes });
  return next;
}

export async function stopCourtTimer(courtId: string, user: SessionUser) {
  const t = await getCourtTimer(courtId);
  await save(courtId, null);
  if (t) await log("COURT_TIMER_STOPPED", t.bookingId, user);
}
