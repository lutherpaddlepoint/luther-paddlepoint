import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteCourt, quotePool, splitReservationFee, PricingError } from "../src/lib/pricing";
import { COURT_RATES, POOL_RATES, OPEN_MINUTE, CLOSE_MINUTE } from "../src/lib/defaults";
import { manilaToUtc, utcToManila, formatMinute } from "../src/lib/time";

const D = "2026-10-12"; // a Monday
const court = (start: number, end: number) =>
  quoteCourt({ date: D, startMinute: start * 60, endMinute: end * 60, rules: COURT_RATES,
    openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE, feePercent: 50 });

test("court day rate: 8–10 AM = ₱400, fee ₱200", () => {
  const q = court(8, 10);
  assert.equal(q.totalCentavos, 400_00);
  assert.equal(q.reservationFeeCentavos, 200_00);
  assert.equal(q.balanceCentavos, 200_00);
});

test("court night rate: 7–9 PM = ₱500", () => {
  assert.equal(court(19, 21).totalCentavos, 500_00);
});

test("court crossover: 4–6 PM = ₱200 + ₱250 = ₱450, fee ₱225", () => {
  const q = court(16, 18);
  assert.equal(q.totalCentavos, 450_00);
  assert.equal(q.reservationFeeCentavos, 225_00);
  assert.equal(q.lineItems.length, 2);
  assert.match(q.lineItems[0].description, /Day rate \(4:00 PM–5:00 PM\)/);
  assert.match(q.lineItems[1].description, /Night rate \(5:00 PM–6:00 PM\)/);
});

test("court long crossover groups hours: 3–8 PM = 2×200 + 3×250 = ₱1,150", () => {
  const q = court(15, 20);
  assert.equal(q.totalCentavos, 1150_00);
  assert.deepEqual(q.lineItems.map((l) => l.quantity), [2, 3]);
});

test("court whole day 6 AM–10 PM = 11×200 + 5×250 = ₱3,450", () => {
  assert.equal(court(6, 22).totalCentavos, 3450_00);
});

test("5 PM exactly is night rate; 4 PM is day rate", () => {
  assert.equal(court(17, 18).totalCentavos, 250_00);
  assert.equal(court(16, 17).totalCentavos, 200_00);
});

test("court rejects outside hours, partial hours, and reversed times", () => {
  assert.throws(() => court(5, 7), PricingError);
  assert.throws(() => court(21, 23), PricingError);
  assert.throws(() => quoteCourt({ date: D, startMinute: 8 * 60 + 30, endMinute: 10 * 60,
    rules: COURT_RATES, openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE, feePercent: 50 }), PricingError);
  assert.throws(() => court(10, 9), PricingError);
});

test("pool: 4 adults + 2 kids = ₱260, fee ₱130", () => {
  const q = quotePool({ date: D, sessionStartMinute: OPEN_MINUTE, adults: 4, kids: 2, rules: POOL_RATES, feePercent: 50 });
  assert.equal(q.totalCentavos, 260_00);
  assert.equal(q.reservationFeeCentavos, 130_00);
});

test("pool night session same price", () => {
  const q = quotePool({ date: D, sessionStartMinute: 17 * 60, adults: 1, kids: 1, rules: POOL_RATES, feePercent: 50 });
  assert.equal(q.totalCentavos, 80_00);
  assert.equal(q.reservationFeeCentavos, 40_00);
});

test("pool requires at least one adult and valid counts", () => {
  assert.throws(() => quotePool({ date: D, sessionStartMinute: OPEN_MINUTE, adults: 0, kids: 3, rules: POOL_RATES, feePercent: 50 }), PricingError);
  assert.throws(() => quotePool({ date: D, sessionStartMinute: OPEN_MINUTE, adults: 0, kids: 0, rules: POOL_RATES, feePercent: 50 }), PricingError);
  assert.throws(() => quotePool({ date: D, sessionStartMinute: OPEN_MINUTE, adults: -1, kids: 2, rules: POOL_RATES, feePercent: 50 }), PricingError);
});

test("reservation fee rounds up to whole peso and always adds up", () => {
  const s = splitReservationFee(25_00 + 15_00 + 1, 50); // odd centavo total
  assert.equal(s.reservationFeeCentavos + s.balanceCentavos, 40_01);
  assert.equal(s.reservationFeeCentavos % 100, 0);
});

test("Manila time conversion: 5 PM Manila = 9 AM UTC, and back", () => {
  const utc = manilaToUtc("2026-10-12", 17 * 60);
  assert.equal(utc.toISOString(), "2026-10-12T09:00:00.000Z");
  assert.deepEqual(utcToManila(utc), { date: "2026-10-12", minuteOfDay: 1020, dayOfWeek: 1 });
  // 6 AM Manila is the previous day in UTC
  assert.equal(manilaToUtc("2026-10-12", 6 * 60).toISOString(), "2026-10-11T22:00:00.000Z");
  assert.equal(formatMinute(0), "12:00 AM");
  assert.equal(formatMinute(720), "12:00 PM");
});
