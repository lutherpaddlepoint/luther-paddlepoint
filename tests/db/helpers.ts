// Shared setup for the database tests.
// Each test starts from an empty database with one court, one pool (30 guests),
// the real rates and settings, an owner and a staff account.
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { COURT_RATES, DEFAULT_SETTINGS, POOL_CAPACITY, POOL_RATES, POOL_SESSIONS } from "../../src/lib/defaults";
import { addDays, todayInManila } from "../../src/lib/time";
import type { CreateBookingInput } from "../../src/lib/validation";
import type { SessionUser } from "../../src/lib/auth";

export { prisma };

// ---------------------------------------------------------------- safety
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !/_test\b|-test\b/.test(url)) {
  console.error("Refusing to run: DATABASE_URL doesn't look like a test database (needs localhost or a name ending in _test).");
  process.exit(1);
}

// ---------------------------------------------------------------- fake outside services
// Storage uploads, deletes and SMS are recorded here instead of really happening.
export const fetchCalls: { url: string; method: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (u.startsWith("http://storage.test/")) {
    fetchCalls.push({ url: u, method });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.startsWith("https://api.semaphore.co/")) {
    fetchCalls.push({ url: u, method });
    return new Response('[{"message_id":1,"status":"Pending"}]', { status: 200 });
  }
  if (u.startsWith("https://api.paymongo.com/")) throw new Error("Tests must not call PayMongo");
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

// ---------------------------------------------------------------- fixtures
export type Fx = {
  courtId: string;
  poolId: string;
  daySessionId: string;
  nightSessionId: string;
  owner: SessionUser;
  staff: SessionUser;
  today: string;
  tomorrow: string;
  later: string; // 3 days ahead: far enough for the 24-hour reschedule rule
};

export async function resetDb(): Promise<Fx> {
  fetchCalls.length = 0;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "notifications", "audit_logs", "payments", "booking_line_items", "bookings",
    "pool_session_inventory", "pool_sessions", "rate_rules", "amenities", "settings", "users" CASCADE`);

  const owner = await prisma.user.create({ data: { name: "Owner", email: "owner@test.local", role: "OWNER", passwordHash: "x" } });
  const staff = await prisma.user.create({ data: { name: "Staff", email: "staff@test.local", role: "STAFF", passwordHash: "x" } });
  const court = await prisma.amenity.create({ data: { type: "COURT", name: "Pickleball Court 1" } });
  const pool = await prisma.amenity.create({ data: { type: "POOL", name: "Swimming Pool", capacity: POOL_CAPACITY } });
  await prisma.rateRule.createMany({
    data: [
      ...COURT_RATES.map((r) => ({ ...r, guestType: null, amenityId: court.id })),
      ...POOL_RATES.map((r) => ({ ...r, guestType: r.guestType ?? null, amenityId: pool.id })),
    ],
  });
  const [day, night] = await Promise.all(POOL_SESSIONS.map((s) => prisma.poolSession.create({ data: { ...s, amenityId: pool.id } })));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) await prisma.setting.create({ data: { key, value: value as never } });

  const today = todayInManila();
  const pick = (u: { id: string; name: string; email: string; role: "OWNER" | "STAFF" }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  return {
    courtId: court.id, poolId: pool.id, daySessionId: day.id, nightSessionId: night.id,
    owner: pick(owner), staff: pick(staff),
    today, tomorrow: addDays(today, 1), later: addDays(today, 3),
  };
}

// ---------------------------------------------------------------- builders
export const courtInput = (fx: Fx, startHour: number, endHour: number, who = "A", date = fx.tomorrow): CreateBookingInput => ({
  amenity: "COURT", amenityId: fx.courtId, date, startMinute: startHour * 60, endMinute: endHour * 60, players: 4,
  name: `Player ${who}`, mobile: "09170000001", email: `${who.toLowerCase()}@example.com`, agreePolicy: true, agreePrivacy: true,
});

export const poolInput = (fx: Fx, sessionId: string, adults: number, kids: number, who = "A", date = fx.tomorrow): CreateBookingInput => ({
  amenity: "POOL", sessionId, date, adults, kids,
  name: `Swimmer ${who}`, mobile: "09170000002", email: `${who.toLowerCase()}@example.com`, agreePolicy: true, agreePrivacy: true,
});

/** A minimal valid PNG header, enough for the image-type check. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);

let refCounter = 0;
export const uniqueGcashRef = () => String(1_000_000_000_000 + Date.now() % 1_000_000 * 100 + (refCounter++ % 100));

export const bookingByRef = (referenceCode: string) =>
  prisma.booking.findUniqueOrThrow({ where: { referenceCode }, include: { payments: true, notifications: true } });

/** Pretend the hold timer ran out, then run the database's expiry function. */
export async function expireHold(referenceCode: string) {
  await prisma.booking.update({ where: { referenceCode }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  await prisma.$queryRaw`SELECT expire_stale_holds()`;
}

/** Mark a hold as paid and confirmed directly (skips the payment flow, for admin tests). */
export async function markConfirmed(referenceCode: string) {
  const b = await prisma.booking.update({
    where: { referenceCode },
    data: { status: "CONFIRMED", holdExpiresAt: null },
  });
  await prisma.payment.create({
    data: { bookingId: b.id, type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: b.reservationFeeCentavos, status: "PAID", paidAt: new Date(), gcashReference: uniqueGcashRef() },
  });
  return b;
}

/** Insert a booking directly, for situations the normal flow can't create (e.g. starting in 1 hour). */
export function rawBooking(fx: Fx, data: { startAt: Date; endAt: Date; status: "CONFIRMED" | "CHECKED_IN"; createdAt?: Date; email?: string; totalCentavos?: number; feeCentavos?: number }) {
  const total = data.totalCentavos ?? 400_00;
  const fee = data.feeCentavos ?? total / 2;
  return prisma.booking.create({
    data: {
      referenceCode: "LPP-" + randomBytes(4).toString("hex").slice(0, 5).toUpperCase().replace(/[01OIL]/g, "Z"),
      accessToken: randomBytes(24).toString("base64url"),
      amenityId: fx.courtId, exclusive: false, // not exclusive: these don't take part in overlap rules
      customerName: "Direct Customer", mobile: "09170000009", email: data.email ?? "direct@example.com",
      startAt: data.startAt, endAt: data.endAt, adults: 2, status: data.status,
      totalCentavos: total, reservationFeeCentavos: fee, balanceCentavos: total - fee,
      createdAt: data.createdAt,
    },
  });
}

export async function poolReserved(sessionId: string, date: string) {
  const inv = await prisma.poolSessionInventory.findUnique({
    where: { poolSessionId_date: { poolSessionId: sessionId, date: new Date(`${date}T00:00:00Z`) } },
  });
  return inv?.reserved ?? 0;
}

export const fulfilled = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled");
export const rejected = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r): r is PromiseRejectedResult => r.status === "rejected");
