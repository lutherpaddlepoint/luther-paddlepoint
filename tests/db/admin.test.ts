// Staff and owner operations: reschedule, check-in, rates.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHold } from "../../src/lib/bookings";
import { checkIn, rescheduleBooking, createWalkIn, AdminError } from "../../src/lib/admin-ops";
import { getRatesForm, saveRates } from "../../src/lib/settings-admin";
import { prisma, resetDb, courtInput, poolInput, markConfirmed, rawBooking, poolReserved, bookingByRef, type Fx } from "./helpers";

let fx: Fx;
beforeEach(async () => { fx = await resetDb(); });
after(() => prisma.$disconnect());

const h = (n: number) => n * 60;

test("reschedule a court booking: paid fee carries over, balance recalculated, once only", async () => {
  const hold = await createHold(courtInput(fx, 8, 10, "A", fx.later)); // ₱400, fee ₱200
  const b = await markConfirmed(hold.referenceCode);
  await rescheduleBooking(b.id, { date: fx.later, startMinute: h(19), endMinute: h(21), overridePolicy: false }, fx.owner); // ₱500 night
  const after1 = await bookingByRef(hold.referenceCode);
  assert.equal(after1.totalCentavos, 500_00);
  assert.equal(after1.reservationFeeCentavos, 200_00);
  assert.equal(after1.balanceCentavos, 300_00);
  assert.equal(after1.rescheduleCount, 1);
  await createHold(courtInput(fx, 8, 10, "B", fx.later)); // old time is free again
  await assert.rejects(
    rescheduleBooking(b.id, { date: fx.later, startMinute: h(6), endMinute: h(7), overridePolicy: true }, fx.owner),
    /maximum/,
  );
});

test("reschedule into a taken time is refused and names the conflict", async () => {
  const a = await markConfirmed((await createHold(courtInput(fx, 8, 9, "A", fx.later))).referenceCode);
  const other = await createHold(courtInput(fx, 15, 16, "B", fx.later));
  await assert.rejects(
    rescheduleBooking(a.id, { date: fx.later, startMinute: h(15), endMinute: h(17), overridePolicy: false }, fx.owner),
    (e: unknown) => e instanceof AdminError && e.message.includes(other.referenceCode),
  );
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: a.id } })).rescheduleCount, 0, "nothing changed");
});

test("less than 24 hours' notice needs the owner's override", async () => {
  const soon = await rawBooking(fx, { startAt: new Date(Date.now() + 2 * 3_600_000), endAt: new Date(Date.now() + 3 * 3_600_000), status: "CONFIRMED" });
  await assert.rejects(rescheduleBooking(soon.id, { date: fx.later, startMinute: h(10), endMinute: h(11), overridePolicy: false }, fx.owner), /24 hours/);
  await rescheduleBooking(soon.id, { date: fx.later, startMinute: h(10), endMinute: h(11), overridePolicy: true }, fx.owner);
});

test("reschedule a pool booking to the night session moves the spots", async () => {
  const hold = await createHold(poolInput(fx, fx.daySessionId, 3, 1, "A", fx.later));
  const b = await markConfirmed(hold.referenceCode);
  await rescheduleBooking(b.id, { date: fx.later, sessionId: fx.nightSessionId, overridePolicy: false }, fx.owner);
  assert.equal(await poolReserved(fx.daySessionId, fx.later), 0);
  assert.equal(await poolReserved(fx.nightSessionId, fx.later), 4);
});

test("check-in records the balance; bookings for another day can't be checked in", async () => {
  const today = await rawBooking(fx, { startAt: new Date(), endAt: new Date(Date.now() + 3_600_000), status: "CONFIRMED", totalCentavos: 400_00, feeCentavos: 200_00 });
  await prisma.payment.create({ data: { bookingId: today.id, type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: 200_00, status: "PAID", paidAt: new Date() } });
  await checkIn(today.id, "CASH", undefined, fx.staff);
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: today.id }, include: { payments: true } });
  assert.equal(b.status, "CHECKED_IN");
  const balance = b.payments.find((p) => p.type === "BALANCE");
  assert.equal(balance?.amountCentavos, 200_00);
  assert.equal(balance?.method, "CASH");
  await assert.rejects(checkIn(today.id, "LATER", undefined, fx.staff), /Already checked in/);

  const tomorrow = await markConfirmed((await createHold(courtInput(fx, 8, 9, "T"))).referenceCode);
  await assert.rejects(checkIn(tomorrow.id, "LATER", undefined, fx.staff), /not today/);
});

test("walk-in paid in full creates two paid payments that add up to the total", async () => {
  const b = await createWalkIn(
    { amenity: "COURT", date: fx.tomorrow, startMinute: h(16), endMinute: h(18), players: 4, name: "Walk In", paid: "FULL", method: "CASH", checkInNow: false },
    fx.staff,
  );
  const payments = await prisma.payment.findMany({ where: { bookingId: b.id, status: "PAID" } });
  assert.equal(payments.reduce((t, p) => t + p.amountCentavos, 0), 450_00);
});

test("new rates apply to new bookings only", async () => {
  const before = await createHold(courtInput(fx, 8, 9, "A"));
  const form = await getRatesForm();
  await saveRates({ ...form, courtDayCentavos: 300_00 }, fx.owner);
  const after = await createHold(courtInput(fx, 9, 10, "B"));
  assert.equal((await bookingByRef(before.referenceCode)).totalCentavos, 200_00);
  assert.equal((await bookingByRef(after.referenceCode)).totalCentavos, 300_00);
});

test("pool capacity can't be lowered below guests already booked", async () => {
  await createHold(poolInput(fx, fx.daySessionId, 10, 0, "A"));
  const form = await getRatesForm();
  await assert.rejects(saveRates({ ...form, poolCapacity: 8 }, fx.owner), (e: unknown) => e instanceof AdminError && /higher number/.test(e.message));
  await saveRates({ ...form, poolCapacity: 40 }, fx.owner);
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 10);
});
