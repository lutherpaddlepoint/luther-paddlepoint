import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, passwordVersion } from "../src/lib/session-core";
import { rescheduleAmounts, buildReport, csvCell, type ReportBooking } from "../src/lib/admin-core";
import { manilaToUtc } from "../src/lib/time";

const SECRET = "x".repeat(40);

test("session cookie: valid, tampered, expired, wrong secret", () => {
  const p = { uid: "u1", role: "STAFF" as const, exp: Date.now() + 60_000, pv: "abc" };
  const tok = signSession(p, SECRET);
  assert.deepEqual(verifySession(tok, SECRET), p);
  const forged = signSession({ ...p, role: "OWNER" }, "y".repeat(40));
  assert.equal(verifySession(forged, SECRET), null);
  const [body, sig] = tok.split(".");
  const tamperedBody = Buffer.from(JSON.stringify({ ...p, role: "OWNER" })).toString("base64url");
  assert.equal(verifySession(`${tamperedBody}.${sig}`, SECRET), null);
  assert.equal(verifySession(signSession({ ...p, exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(verifySession(undefined, SECRET), null);
  assert.equal(verifySession(body, SECRET), null);
});

test("password version changes when the password changes", () => {
  assert.notEqual(passwordVersion("hashA", SECRET), passwordVersion("hashB", SECRET));
  assert.equal(passwordVersion("hashA", SECRET), passwordVersion("hashA", SECRET));
});

test("reschedule keeps the paid fee and recalculates the balance", () => {
  // ₱400 day booking (fee ₱200) moved to 2 night hours ₱500
  assert.deepEqual(rescheduleAmounts(500_00, 200_00), { reservationFeeCentavos: 200_00, balanceCentavos: 300_00, totalCentavos: 500_00 });
  // ₱500 night (fee ₱250) moved to 1 day hour ₱200: fee is non-refundable, nothing more to pay
  assert.deepEqual(rescheduleAmounts(200_00, 250_00), { reservationFeeCentavos: 250_00, balanceCentavos: 0, totalCentavos: 250_00 });
});

const D = "2026-10-12";
const h = (n: number) => n * 60;
const b = (o: Partial<ReportBooking>): ReportBooking => ({
  amenityType: "COURT", kind: "BOOKING", status: "CONFIRMED", source: "ONLINE",
  startAt: manilaToUtc(D, h(8)), endAt: manilaToUtc(D, h(10)), totalCentavos: 400_00, adults: 4, kids: 0,
  lineItems: [{ description: "Day rate (8:00 AM–10:00 AM)", amountCentavos: 400_00 }], ...o,
});

test("report: values, day/night split, occupancy, collected, peak hours", () => {
  const r = buildReport({
    from: D, to: D, days: [D], openMinute: h(6), closeMinute: h(22), lightsOnMinute: h(17),
    bookings: [
      b({}),
      b({ startAt: manilaToUtc(D, h(16)), endAt: manilaToUtc(D, h(18)), totalCentavos: 450_00, source: "WALK_IN",
          lineItems: [{ description: "Day rate (4:00 PM–5:00 PM)", amountCentavos: 200_00 }, { description: "Night rate (5:00 PM–6:00 PM)", amountCentavos: 250_00 }] }),
      b({ kind: "BLOCK", startAt: manilaToUtc(D, h(12)), endAt: manilaToUtc(D, h(14)), totalCentavos: 0, lineItems: [] }),
      b({ status: "CANCELLED", startAt: manilaToUtc(D, h(19)), endAt: manilaToUtc(D, h(20)) }),
      b({ status: "NO_SHOW", startAt: manilaToUtc(D, h(20)), endAt: manilaToUtc(D, h(21)) }),
      b({ amenityType: "POOL", startAt: manilaToUtc(D, h(6)), endAt: manilaToUtc(D, h(17)), totalCentavos: 260_00, adults: 4, kids: 2, lineItems: [] }),
      b({ amenityType: "POOL", startAt: manilaToUtc(D, h(17)), endAt: manilaToUtc(D, h(22)), totalCentavos: 190_00, adults: 2, kids: 3, lineItems: [] }),
    ],
    payments: [
      { method: "GCASH_MANUAL", amountCentavos: 200_00, paidAt: manilaToUtc(D, h(9)), amenityType: "COURT" },
      { method: "CASH", amountCentavos: 450_00, paidAt: manilaToUtc(D, h(16)), amenityType: "COURT" },
      { method: "GCASH_MANUAL", amountCentavos: 130_00, paidAt: manilaToUtc(D, h(7)), amenityType: "POOL" },
    ],
  });
  assert.equal(r.bookingsCount, 4);
  assert.equal(r.walkIns, 1);
  assert.equal(r.noShows, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.value.court, 850_00);
  assert.equal(r.value.courtNight, 250_00);
  assert.equal(r.value.courtDay, 600_00);
  assert.equal(r.value.poolNight, 190_00);
  assert.equal(r.pool.dayGuests, 6);
  assert.equal(r.pool.nightGuests, 5);
  assert.equal(r.court.hoursBooked, 4);
  assert.equal(r.court.hoursAvailable, 14); // 16 open hours minus 2 blocked
  assert.equal(r.collected.total, 780_00);
  assert.equal(r.collected.cash, 450_00);
  assert.equal(r.collected.gcash, 330_00);
  assert.equal(r.peakHours.find((p) => p.minute === h(8))!.count, 1);
  assert.equal(r.peakHours.find((p) => p.minute === h(17))!.count, 1);
  assert.equal(r.byDay[0].poolGuests, 11);
});

test("CSV cells are escaped and formula injection is blocked", () => {
  assert.equal(csvCell('Dela Cruz, "JD"'), '"Dela Cruz, ""JD"""');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(450), "450");
});
