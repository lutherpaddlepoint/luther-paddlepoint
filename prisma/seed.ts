// Seed data for Luther PaddlePoint & Pool.
// Run with: npm run db:seed   (DEVELOPMENT ONLY — it clears existing data)

import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import { quoteCourt, quotePool, type PriceQuote } from "../src/lib/pricing";
import { manilaToUtc, todayInManila, addDays } from "../src/lib/time";
import {
  COURT_RATES, POOL_RATES, POOL_SESSIONS, POOL_CAPACITY,
  OPEN_MINUTE, CLOSE_MINUTE, DEFAULT_SETTINGS,
} from "../src/lib/defaults";

const prisma = new PrismaClient();
const FEE_PERCENT = DEFAULT_SETTINGS.reservation_fee_percent;

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "yes") {
  console.error("Refusing to seed a production database (it deletes all data).");
  process.exit(1);
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const referenceCode = () =>
  "LPP-" + Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");

const newToken = () => randomBytes(24).toString("base64url");
const generatedPassword = () => randomBytes(9).toString("base64url");

async function main() {
  console.log("Clearing existing data…");
  await prisma.auditLog.deleteMany();
  await prisma.match.deleteMany();
  await prisma.openPlayPlayer.deleteMany();
  await prisma.openPlaySession.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingLineItem.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.poolSessionInventory.deleteMany();
  await prisma.poolSession.deleteMany();
  await prisma.rateRule.deleteMany();
  await prisma.amenity.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.user.deleteMany();

  // ---------------------------------------------------------------- accounts
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || generatedPassword();
  const staffPassword = process.env.SEED_STAFF_PASSWORD || generatedPassword();
  const ownerEmail = process.env.SEED_OWNER_EMAIL || "owner@lutherpaddlepoint.local";

  const owner = await prisma.user.create({
    data: { name: "Owner", email: ownerEmail, role: "OWNER", passwordHash: await bcrypt.hash(ownerPassword, 12) },
  });
  const staffHash = await bcrypt.hash(staffPassword, 12);
  const staff = await Promise.all(
    [1, 2, 3].map((n) =>
      prisma.user.create({
        data: { name: `Staff ${n}`, email: `staff${n}@lutherpaddlepoint.local`, role: "STAFF", passwordHash: staffHash },
      }),
    ),
  );

  // --------------------------------------------------------------- amenities
  const court = await prisma.amenity.create({ data: { type: "COURT", name: "Pickleball Court 1" } });
  const court2 = await prisma.amenity.create({ data: { type: "COURT", name: "Pickleball Court 2" } });
  const pool = await prisma.amenity.create({ data: { type: "POOL", name: "Swimming Pool", capacity: POOL_CAPACITY } });

  await prisma.rateRule.createMany({
    data: [
      ...COURT_RATES.map((r) => ({ ...r, guestType: null, amenityId: court.id })),
      ...COURT_RATES.map((r) => ({ ...r, guestType: null, amenityId: court2.id })),
      ...POOL_RATES.map((r) => ({ ...r, guestType: r.guestType ?? null, amenityId: pool.id })),
    ],
  });

  const sessions = await Promise.all(
    POOL_SESSIONS.map((s) => prisma.poolSession.create({ data: { ...s, amenityId: pool.id } })),
  );
  const [daySession, nightSession] = sessions;

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.create({ data: { key, value: value as Prisma.InputJsonValue } });
  }

  // --------------------------------------------------------- sample bookings
  const tomorrow = addDays(todayInManila(), 1);
  const at = (minute: number, date = tomorrow) => manilaToUtc(date, minute);
  const h = (hour: number) => hour * 60;

  const courtQuote = (startH: number, endH: number) =>
    quoteCourt({ date: tomorrow, startMinute: h(startH), endMinute: h(endH), rules: COURT_RATES,
      openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE, feePercent: FEE_PERCENT });

  const money = (q: PriceQuote) => ({
    totalCentavos: q.totalCentavos,
    reservationFeeCentavos: q.reservationFeeCentavos,
    balanceCentavos: q.balanceCentavos,
    lineItems: { create: q.lineItems },
  });

  const now = new Date();

  // 1. Court 8–10 AM, paid reservation fee via manual GCash, verified by staff
  const q1 = courtQuote(8, 10);
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, exclusive: true,
      customerName: "Juan Dela Cruz", mobile: "09170000001", email: "juan@example.com",
      startAt: at(h(8)), endAt: at(h(10)), adults: 4, status: "CONFIRMED", agreedToPolicyAt: now,
      ...money(q1),
      payments: { create: {
        type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: q1.reservationFeeCentavos,
        gcashReference: "1000000000001", status: "PAID", verifiedById: staff[0].id, paidAt: now,
      } },
    },
  });

  // 2. Maintenance block 12–2 PM
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, kind: "BLOCK", exclusive: true,
      startAt: at(h(12)), endAt: at(h(14)), status: "CONFIRMED", notes: "Court resurfacing",
      createdById: owner.id,
    },
  });

  // 3. Court 4–6 PM (crosses 5 PM: ₱200 + ₱250), GCash proof waiting for staff
  const q3 = courtQuote(16, 18);
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, exclusive: true,
      customerName: "Maria Santos", mobile: "09170000002", email: "maria@example.com",
      startAt: at(h(16)), endAt: at(h(18)), adults: 4, status: "PENDING_VERIFICATION", agreedToPolicyAt: now,
      ...money(q3),
      payments: { create: {
        type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: q3.reservationFeeCentavos,
        gcashReference: "1000000000002", proofImagePath: "proofs/sample-proof.jpg", status: "PENDING",
      } },
    },
  });

  // 4. Walk-in 7–9 PM, paid in full cash
  const q4 = courtQuote(19, 21);
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, exclusive: true, source: "WALK_IN",
      customerName: "Pedro Reyes", mobile: "09170000003",
      startAt: at(h(19)), endAt: at(h(21)), adults: 2, status: "CONFIRMED", createdById: staff[1].id,
      ...money(q4),
      payments: { create: [
        { type: "RESERVATION_FEE", method: "CASH", amountCentavos: q4.reservationFeeCentavos, status: "PAID", verifiedById: staff[1].id, paidAt: now },
        { type: "BALANCE", method: "CASH", amountCentavos: q4.balanceCentavos, status: "PAID", verifiedById: staff[1].id, paidAt: now },
      ] },
    },
  });

  // 5. Pool day session: 4 adults + 2 kids (₱260)
  // 6. Pool night session: 2 adults + 3 kids, proof waiting
  const tomorrowDate = new Date(`${tomorrow}T00:00:00Z`);
  const dayInv = await prisma.poolSessionInventory.create({
    data: { poolSessionId: daySession.id, date: tomorrowDate, capacity: POOL_CAPACITY, reserved: 6 },
  });
  const nightInv = await prisma.poolSessionInventory.create({
    data: { poolSessionId: nightSession.id, date: tomorrowDate, capacity: POOL_CAPACITY, reserved: 5 },
  });

  const q5 = quotePool({ date: tomorrow, sessionStartMinute: daySession.startMinute, adults: 4, kids: 2, rules: POOL_RATES, feePercent: FEE_PERCENT });
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: pool.id, exclusive: false, poolInventoryId: dayInv.id,
      customerName: "Ana Garcia", mobile: "09170000004", email: "ana@example.com",
      startAt: at(daySession.startMinute), endAt: at(daySession.endMinute), adults: 4, kids: 2,
      status: "CONFIRMED", agreedToPolicyAt: now, ...money(q5),
      payments: { create: {
        type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: q5.reservationFeeCentavos,
        gcashReference: "1000000000005", status: "PAID", verifiedById: staff[2].id, paidAt: now,
      } },
    },
  });

  const q6 = quotePool({ date: tomorrow, sessionStartMinute: nightSession.startMinute, adults: 2, kids: 3, rules: POOL_RATES, feePercent: FEE_PERCENT });
  await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: pool.id, exclusive: false, poolInventoryId: nightInv.id,
      customerName: "Jose Ramos", mobile: "09170000006", email: "jose@example.com",
      startAt: at(nightSession.startMinute), endAt: at(nightSession.endMinute), adults: 2, kids: 3,
      status: "PENDING_VERIFICATION", agreedToPolicyAt: now, ...money(q6),
      payments: { create: {
        type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: q6.reservationFeeCentavos,
        gcashReference: "1000000000006", proofImagePath: "proofs/sample-proof-2.jpg", status: "PENDING",
      } },
    },
  });

  // ------------------------------------------------------------ self-checks
  console.log("\nRunning safety checks…");

  // A. Overlapping court booking must be rejected by the database (9–11 AM overlaps 8–10 AM)
  try {
    await prisma.booking.create({
      data: {
        referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, exclusive: true,
        customerName: "Double Booker", startAt: at(h(9)), endAt: at(h(11)),
        status: "HOLD", holdExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    throw new Error("FAILED: database allowed a double booking. Were the constraints appended to the migration?");
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.startsWith("FAILED")) throw e;
    if (!msg.includes("bookings_no_overlap") && !msg.includes("23P01")) throw e;
    console.log("  ✓ Double booking blocked by the database");
  }

  // B. Back-to-back bookings are allowed (10–11 AM right after 8–10 AM)
  const backToBack = await prisma.booking.create({
    data: {
      referenceCode: referenceCode(), accessToken: newToken(), amenityId: court.id, exclusive: true, customerName: "Back To Back",
      startAt: at(h(10)), endAt: at(h(11)), status: "HOLD", holdExpiresAt: new Date(Date.now() - 60_000),
    },
  });
  console.log("  ✓ Back-to-back booking allowed");

  // C. Expired holds are released (the hold above expired a minute ago)
  const [{ expire_stale_holds: expired }] =
    await prisma.$queryRaw<{ expire_stale_holds: number }[]>`SELECT expire_stale_holds()`;
  const after = await prisma.booking.findUniqueOrThrow({ where: { id: backToBack.id } });
  if (after.status !== "EXPIRED" || expired < 1) throw new Error("FAILED: stale hold was not expired");
  await prisma.booking.delete({ where: { id: backToBack.id } });
  console.log("  ✓ Expired holds released automatically");

  // D. Pool can never go over 30 (6 reserved + 25 = 31)
  const [{ reserve_pool_spots: overCap }] = await prisma.$queryRaw<{ reserve_pool_spots: number | null }[]>`
    SELECT reserve_pool_spots(${dayInv.id}::uuid, 25)`;
  if (overCap !== null) throw new Error("FAILED: pool capacity exceeded");
  const [{ reserve_pool_spots: fits }] = await prisma.$queryRaw<{ reserve_pool_spots: number | null }[]>`
    SELECT reserve_pool_spots(${dayInv.id}::uuid, 24)`;
  if (fits !== 30) throw new Error("FAILED: pool should accept exactly up to capacity");
  await prisma.poolSessionInventory.update({ where: { id: dayInv.id }, data: { reserved: 6 } });
  console.log("  ✓ Pool capacity limit (30) enforced");

  // ---------------------------------------------------------------- summary
  console.log(`
Seed complete for ${tomorrow} (tomorrow, Manila time).

Login accounts — save these now, they are shown only once:
  Owner : ${ownerEmail}  /  ${ownerPassword}
  Staff : staff1@ / staff2@ / staff3@lutherpaddlepoint.local  /  ${staffPassword}
  (Change these passwords after first login.)

Sample bookings:
  Court 8–10 AM   Juan Dela Cruz   CONFIRMED             ₱400  (fee ₱200 paid)
  Court 12–2 PM   Maintenance      BLOCKED
  Court 4–6 PM    Maria Santos     PENDING_VERIFICATION  ₱450  (₱200 day + ₱250 night)
  Court 7–9 PM    Pedro Reyes      WALK-IN, CASH         ₱500
  Pool day        Ana Garcia       CONFIRMED             ₱260  (4 adults, 2 kids)  → 6/30
  Pool night      Jose Ramos       PENDING_VERIFICATION  ₱190  (2 adults, 3 kids)  → 5/30
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
