// The court can never be double-booked, no matter how requests arrive.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHold, BookingError } from "../../src/lib/bookings";
import { cancelBooking, createCourtBlock, createWalkIn, AdminError } from "../../src/lib/admin-ops";
import { prisma, resetDb, courtInput, expireHold, fulfilled, rejected, markConfirmed, type Fx } from "./helpers";

let fx: Fx;
beforeEach(async () => { fx = await resetDb(); });
after(() => prisma.$disconnect());

const activeCourtBookings = () =>
  prisma.booking.count({ where: { amenityId: fx.courtId, status: { in: ["HOLD", "PENDING_VERIFICATION", "CONFIRMED", "CHECKED_IN"] } } });

test("10 people tap Book for the same hour at the same moment: exactly 1 wins", async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createHold(courtInput(fx, 16, 17, `P${i}`))));
  assert.equal(fulfilled(results).length, 1);
  assert.equal(rejected(results).length, 9);
  for (const r of rejected(results)) {
    assert.ok(r.reason instanceof BookingError, String(r.reason));
    assert.equal((r.reason as BookingError).status, 409);
  }
  assert.equal(await activeCourtBookings(), 1);
});

test("overlapping (not identical) times at the same moment: only one wins", async () => {
  const results = await Promise.allSettled([createHold(courtInput(fx, 8, 10, "A")), createHold(courtInput(fx, 9, 11, "B"))]);
  assert.equal(fulfilled(results).length, 1);
  assert.equal(await activeCourtBookings(), 1);
});

test("back-to-back bookings are both allowed (8–10 then 10–11)", async () => {
  await createHold(courtInput(fx, 8, 10, "A"));
  await createHold(courtInput(fx, 10, 11, "B"));
  assert.equal(await activeCourtBookings(), 2);
});

test("an expired, unpaid hold frees the slot", async () => {
  const a = await createHold(courtInput(fx, 18, 19, "A"));
  await assert.rejects(createHold(courtInput(fx, 18, 19, "B")), BookingError);
  await expireHold(a.referenceCode);
  await createHold(courtInput(fx, 18, 19, "B"));
});

test("a cancelled booking frees the slot", async () => {
  const a = await createHold(courtInput(fx, 7, 8, "A"));
  const b = await markConfirmed(a.referenceCode);
  await cancelBooking(b.id, "Customer request", fx.owner);
  await createHold(courtInput(fx, 7, 8, "B"));
});

test("walk-in can't take a booked hour; the message names the booking", async () => {
  const a = await createHold(courtInput(fx, 19, 20, "A"));
  await assert.rejects(
    createWalkIn({ amenity: "COURT", date: fx.tomorrow, startMinute: 19 * 60, endMinute: 21 * 60, players: 2, name: "Walk In", paid: "FULL", method: "CASH", checkInNow: false }, fx.staff),
    (e: unknown) => e instanceof AdminError && e.message.includes(a.referenceCode),
  );
});

test("a maintenance block can't cover existing bookings, and blocks customers once created", async () => {
  await createHold(courtInput(fx, 12, 13, "A"));
  await assert.rejects(createCourtBlock(fx.tomorrow, 11 * 60, 14 * 60, "Resurfacing", fx.owner), AdminError);
  await createCourtBlock(fx.tomorrow, 14 * 60, 16 * 60, "Resurfacing", fx.owner);
  await assert.rejects(createHold(courtInput(fx, 15, 16, "B")), BookingError);
});

test("the database itself refuses an overlap even if app checks are bypassed", async () => {
  const base = {
    amenityId: fx.courtId, exclusive: true, status: "CONFIRMED" as const,
    startAt: new Date(Date.now() + 48 * 3_600_000), endAt: new Date(Date.now() + 50 * 3_600_000),
  };
  await prisma.booking.create({ data: { ...base, referenceCode: "LPP-AAAAA", accessToken: "t1" } });
  await assert.rejects(
    prisma.booking.create({ data: { ...base, referenceCode: "LPP-BBBBB", accessToken: "t2", startAt: new Date(base.startAt.getTime() + 3_600_000) } }),
    /bookings_no_overlap|23P01/,
  );
});

test("two courts: the same hour can be booked once on each court, never twice on one", async () => {
  const court2 = await prisma.amenity.create({ data: { type: "COURT", name: "Pickleball Court 2" } });
  const rules = await prisma.rateRule.findMany({ where: { amenityId: fx.courtId, isActive: true } });
  await prisma.rateRule.createMany({ data: rules.map(({ id: _id, amenityId: _a, ...r }) => ({ ...r, amenityId: court2.id })) });

  const results = await Promise.allSettled([
    createHold(courtInput(fx, 16, 17, "A")),
    createHold({ ...courtInput(fx, 16, 17, "B"), amenityId: court2.id }),
    createHold({ ...courtInput(fx, 16, 17, "C"), amenityId: court2.id }),
  ]);
  assert.equal(fulfilled(results).length, 2); // one on each court
  const byCourt = await prisma.booking.groupBy({ by: ["amenityId"], where: { status: "HOLD" }, _count: { _all: true } });
  assert.deepEqual(byCourt.map((r) => r._count._all).sort(), [1, 1]);

  // A block on Court 2 leaves Court 1 alone.
  await createCourtBlock(fx.tomorrow, 8 * 60, 10 * 60, "Court 2 repairs", fx.owner, court2.id);
  await createHold(courtInput(fx, 8, 9, "D"));
  await assert.rejects(createHold({ ...courtInput(fx, 8, 9, "E"), amenityId: court2.id }), BookingError);
});
