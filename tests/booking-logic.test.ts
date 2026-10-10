import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCourtSlots, buildPoolSessions } from "../src/lib/availability-core";
import { toggleSlot, rangeStillAvailable } from "../src/lib/selection";
import { normalizePhMobile } from "../src/lib/phone";
import { COURT_RATES, OPEN_MINUTE, CLOSE_MINUTE, DAY_NIGHT_CUTOFF } from "../src/lib/defaults";
import { manilaToUtc } from "../src/lib/time";

const D = "2026-10-12";
const h = (n: number) => n * 60;
const slotsWith = (busy: Parameters<typeof buildCourtSlots>[0]["busy"], now = manilaToUtc("2026-10-11", h(20))) =>
  buildCourtSlots({ date: D, now, busy, rules: COURT_RATES, openMinute: OPEN_MINUTE, closeMinute: CLOSE_MINUTE, lightsOnMinute: DAY_NIGHT_CUTOFF });

test("court has 16 one-hour slots, 6 AM to 10 PM; 5 PM onward is night", () => {
  const s = slotsWith([]);
  assert.equal(s.length, 16);
  assert.equal(s[0].label, "6:00 AM");
  assert.equal(s[15].label, "9:00 PM");
  assert.equal(s.filter((x) => x.isNight).length, 5);
  assert.equal(s.find((x) => x.startMinute === h(17))!.priceCentavos, 250_00);
});

test("booked and blocked hours show correctly; back-to-back edges stay free", () => {
  const s = slotsWith([
    { startAt: manilaToUtc(D, h(8)), endAt: manilaToUtc(D, h(10)), kind: "BOOKING" },
    { startAt: manilaToUtc(D, h(12)), endAt: manilaToUtc(D, h(14)), kind: "BLOCK" },
  ]);
  const at = (hr: number) => s.find((x) => x.startMinute === h(hr))!.status;
  assert.equal(at(7), "available");
  assert.equal(at(8), "booked");
  assert.equal(at(9), "booked");
  assert.equal(at(10), "available");
  assert.equal(at(12), "blocked");
  assert.equal(at(14), "available");
});

test("hours that already started today are past", () => {
  const s = slotsWith([], manilaToUtc(D, h(9) + 15)); // 9:15 AM
  assert.equal(s.find((x) => x.startMinute === h(9))!.status, "past");
  assert.equal(s.find((x) => x.startMinute === h(10))!.status, "available");
});

test("pool sessions: remaining spots, full, closed, and booking cutoff", () => {
  const sessions = [
    { id: "night", name: "Night session", startMinute: h(17), endMinute: h(22) },
    { id: "day", name: "Day session", startMinute: h(6), endMinute: h(17) },
  ];
  const v = buildPoolSessions({
    date: D, now: manilaToUtc("2026-10-11", h(12)), sessions, defaultCapacity: 30, cutoffMinutes: 60,
    inventory: [{ poolSessionId: "day", capacity: 30, reserved: 24, isClosed: false }],
  });
  assert.equal(v[0].id, "day"); // sorted by time
  assert.equal(v[0].remaining, 6);
  assert.equal(v[1].remaining, 30);

  const full = buildPoolSessions({ date: D, now: manilaToUtc("2026-10-11", h(12)), sessions, defaultCapacity: 30, cutoffMinutes: 60,
    inventory: [{ poolSessionId: "day", capacity: 30, reserved: 30, isClosed: false },
                { poolSessionId: "night", capacity: 30, reserved: 0, isClosed: true }] });
  assert.equal(full[0].status, "full");
  assert.equal(full[1].status, "closed");

  const late = buildPoolSessions({ date: D, now: manilaToUtc(D, h(16) + 5), sessions, defaultCapacity: 30, cutoffMinutes: 60, inventory: [] });
  assert.equal(late[0].status, "past"); // day session closes to bookings at 4 PM
  assert.equal(late[1].status, "available");
});

test("tapping slots builds one continuous block", () => {
  const free = (m: number) => m !== h(12);
  let r = toggleSlot(null, h(15), free);
  assert.deepEqual(r, { start: h(15), end: h(16) });
  r = toggleSlot(r, h(16), free); // extend after
  r = toggleSlot(r, h(14), free); // extend before
  assert.deepEqual(r, { start: h(14), end: h(17) });
  r = toggleSlot(r, h(16), free); // shrink end
  assert.deepEqual(r, { start: h(14), end: h(16) });
  r = toggleSlot(r, h(19), free); // far away: start over
  assert.deepEqual(r, { start: h(19), end: h(20) });
  r = toggleSlot(r, h(19), free); // tap only slot: clear
  assert.equal(r, null);
  assert.equal(toggleSlot(null, h(12), free), null); // unavailable: ignored
  assert.equal(rangeStillAvailable({ start: h(11), end: h(13) }, free), false);
});

test("Philippine mobile numbers are normalized", () => {
  assert.equal(normalizePhMobile("0917 123 4567"), "09171234567");
  assert.equal(normalizePhMobile("+63 917-123-4567"), "09171234567");
  assert.equal(normalizePhMobile("639171234567"), "09171234567");
  assert.equal(normalizePhMobile("9171234567"), "09171234567");
  assert.equal(normalizePhMobile("0817 123 4567"), null);
  assert.equal(normalizePhMobile("12345"), null);
});
