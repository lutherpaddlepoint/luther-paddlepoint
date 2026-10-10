// Manila time helpers. The Philippines is UTC+8 all year (no daylight saving),
// so conversions are a fixed offset — no timezone library needed.

export const MANILA_OFFSET_MINUTES = 8 * 60;
const MS_PER_MINUTE = 60_000;

/** "YYYY-MM-DD" + minutes after midnight (Manila) -> UTC Date to store in the database. */
export function manilaToUtc(date: string, minuteOfDay: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d) + (minuteOfDay - MANILA_OFFSET_MINUTES) * MS_PER_MINUTE;
  return new Date(utcMs);
}

/** UTC Date from the database -> Manila calendar date, minute of day, weekday (0 = Sunday). */
export function utcToManila(instant: Date) {
  const shifted = new Date(instant.getTime() + MANILA_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    date: shifted.toISOString().slice(0, 10),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

/** Today's calendar date in Manila, "YYYY-MM-DD". */
export function todayInManila(now: Date = new Date()): string {
  return utcToManila(now).date;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 1020 -> "5:00 PM" */
export function formatMinute(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** "HH:MM" -> minutes after midnight */
export function toMinute(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
