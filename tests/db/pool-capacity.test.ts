// The pool can never go over 30 guests per session.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHold, BookingError } from "../../src/lib/bookings";
import { cancelBooking, createWalkIn, markNoShow, setPoolClosed, AdminError } from "../../src/lib/admin-ops";
import { prisma, resetDb, poolInput, expireHold, fulfilled, rejected, poolReserved, markConfirmed, type Fx } from "./helpers";

let fx: Fx;
beforeEach(async () => { fx = await resetDb(); });
after(() => prisma.$disconnect());

test("10 groups of 4 book at the same moment: 7 fit (28 guests), 3 are told it's full", async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createHold(poolInput(fx, fx.daySessionId, 4, 0, `G${i}`))));
  assert.equal(fulfilled(results).length, 7);
  assert.equal(rejected(results).length, 3);
  for (const r of rejected(results)) assert.match((r.reason as Error).message, /spots? left|full/);
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 28);
});

test("fills to exactly 30, then refuses one more guest", async () => {
  await createHold(poolInput(fx, fx.daySessionId, 20, 0, "A"));
  await createHold(poolInput(fx, fx.daySessionId, 8, 2, "B"));
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 30);
  await assert.rejects(createHold(poolInput(fx, fx.daySessionId, 1, 0, "C")), /full/);
  // The night session is separate
  await createHold(poolInput(fx, fx.nightSessionId, 1, 0, "D"));
});

test("online and walk-in bookings share the same 30 spots", async () => {
  await createHold(poolInput(fx, fx.daySessionId, 25, 0, "A"));
  await assert.rejects(
    createWalkIn({ amenity: "POOL", date: fx.tomorrow, sessionId: fx.daySessionId, adults: 6, kids: 0, name: "Walk In", paid: "FULL", method: "CASH", checkInNow: false }, fx.staff),
    (e: unknown) => e instanceof AdminError && /5 spots left/.test(e.message),
  );
  await createWalkIn({ amenity: "POOL", date: fx.tomorrow, sessionId: fx.daySessionId, adults: 5, kids: 0, name: "Walk In", paid: "FULL", method: "CASH", checkInNow: false }, fx.staff);
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 30);
});

test("expired holds give their spots back exactly once", async () => {
  const a = await createHold(poolInput(fx, fx.daySessionId, 4, 2, "A"));
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 6);
  await expireHold(a.referenceCode);
  await prisma.$queryRaw`SELECT expire_stale_holds()`; // running again must not subtract again
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 0);
});

test("cancel and no-show give spots back", async () => {
  const a = await createHold(poolInput(fx, fx.daySessionId, 3, 0, "A"));
  const b = await createHold(poolInput(fx, fx.daySessionId, 2, 0, "B"));
  const ba = await markConfirmed(a.referenceCode);
  const bb = await markConfirmed(b.referenceCode);
  await cancelBooking(ba.id, "Bad weather", fx.owner);
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 2);
  await prisma.booking.update({ where: { id: bb.id }, data: { startAt: new Date(Date.now() - 3_600_000) } }); // pretend it started
  await markNoShow(bb.id, fx.staff);
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 0);
});

test("a closed session takes no bookings; reopening allows them again", async () => {
  await setPoolClosed(fx.daySessionId, fx.tomorrow, true, "Cleaning", fx.owner);
  await assert.rejects(createHold(poolInput(fx, fx.daySessionId, 2, 0, "A")), (e: unknown) => e instanceof BookingError && /closed/.test(e.message));
  await setPoolClosed(fx.daySessionId, fx.tomorrow, false, "", fx.owner);
  await createHold(poolInput(fx, fx.daySessionId, 2, 0, "A"));
});

test("the database refuses to go over capacity even if app checks are bypassed", async () => {
  await createHold(poolInput(fx, fx.daySessionId, 29, 0, "A"));
  await assert.rejects(
    prisma.poolSessionInventory.updateMany({ where: { poolSessionId: fx.daySessionId }, data: { reserved: { increment: 2 } } }),
    /pool_inventory_capacity_check|23514/,
  );
});
