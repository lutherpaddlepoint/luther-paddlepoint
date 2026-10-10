// The scheduled job (reminders, retries, cleanup) and the owner's reports.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { runScheduledJobs } from "../../src/lib/jobs";
import { createWalkIn } from "../../src/lib/admin-ops";
import { reportData } from "../../src/lib/admin-data";
import { prisma, resetDb, rawBooking, fetchCalls, type Fx } from "./helpers";

let fx: Fx;
beforeEach(async () => { fx = await resetDb(); });
after(() => prisma.$disconnect());

const HOUR = 3_600_000;

test("reminder goes out once (email + SMS), even if the job runs again", async () => {
  const b = await rawBooking(fx, { startAt: new Date(Date.now() + HOUR), endAt: new Date(Date.now() + 2 * HOUR), status: "CONFIRMED", createdAt: new Date(Date.now() - 24 * HOUR) });
  await runScheduledJobs();
  await runScheduledJobs();
  const msgs = await prisma.notification.findMany({ where: { bookingId: b.id, event: "REMINDER" } });
  assert.equal(msgs.filter((m) => m.channel === "EMAIL").length, 1);
  const sms = msgs.filter((m) => m.channel === "SMS");
  assert.equal(sms.length, 1);
  assert.equal(sms[0].status, "SENT");
  assert.equal(fetchCalls.filter((c) => c.url.includes("semaphore")).length, 1);
});

test("no reminder for a booking made inside the reminder window", async () => {
  const b = await rawBooking(fx, { startAt: new Date(Date.now() + HOUR), endAt: new Date(Date.now() + 2 * HOUR), status: "CONFIRMED", createdAt: new Date() });
  await runScheduledJobs();
  assert.equal(await prisma.notification.count({ where: { bookingId: b.id, event: "REMINDER" } }), 0);
});

test("checked-in bookings become completed after they end", async () => {
  const b = await rawBooking(fx, { startAt: new Date(Date.now() - 3 * HOUR), endAt: new Date(Date.now() - HOUR), status: "CHECKED_IN" });
  const s = await runScheduledJobs();
  assert.equal(s.completed, 1);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status, "COMPLETED");
});

test("GCash screenshots are deleted 90 days after the booking", async () => {
  const old = await rawBooking(fx, { startAt: new Date(Date.now() - 100 * 24 * HOUR), endAt: new Date(Date.now() - 100 * 24 * HOUR + HOUR), status: "CONFIRMED" });
  const recent = await rawBooking(fx, { startAt: new Date(Date.now() - 10 * 24 * HOUR), endAt: new Date(Date.now() - 10 * 24 * HOUR + HOUR), status: "CONFIRMED" });
  for (const b of [old, recent])
    await prisma.payment.create({ data: { bookingId: b.id, type: "RESERVATION_FEE", method: "GCASH_MANUAL", amountCentavos: 1, status: "PAID", proofImagePath: `${b.id}/x.png` } });
  await runScheduledJobs();
  const [po, pr] = await Promise.all([old, recent].map((b) => prisma.payment.findFirstOrThrow({ where: { bookingId: b.id } })));
  assert.equal(po.proofImagePath, null);
  assert.equal(pr.proofImagePath, `${recent.id}/x.png`);
  assert.equal(fetchCalls.filter((c) => c.method === "DELETE").length, 1);
});

test("report: collected money, booking value, day/night split, walk-ins", async () => {
  await createWalkIn( // ₱200 day + ₱250 night, paid in full in cash now
    { amenity: "COURT", date: fx.tomorrow, startMinute: 16 * 60, endMinute: 18 * 60, players: 4, name: "Court Walk-in", paid: "FULL", method: "CASH", checkInNow: false },
    fx.staff,
  );
  await createWalkIn( // 2 adults + 1 kid = ₱130, reservation fee ₱65 by GCash now
    { amenity: "POOL", date: fx.tomorrow, sessionId: fx.daySessionId, adults: 2, kids: 1, name: "Pool Walk-in", paid: "FEE", method: "GCASH_MANUAL", gcashReference: "9876543210123", checkInNow: false },
    fx.staff,
  );
  const r = await reportData(fx.today, fx.tomorrow);
  assert.equal(r.bookingsCount, 2);
  assert.equal(r.walkIns, 2);
  assert.equal(r.value.court, 450_00);
  assert.equal(r.value.courtNight, 250_00);
  assert.equal(r.value.pool, 130_00);
  assert.equal(r.collected.total, 515_00);
  assert.equal(r.collected.cash, 450_00);
  assert.equal(r.collected.gcash, 65_00);
  assert.equal(r.pool.dayGuests, 3);
  assert.equal(r.court.hoursBooked, 2);
});
