// Open play (paddle stacking): hourly charge and line rotation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backOfLine, feeCentavos, gamesUntilTurn, hoursToCharge, nextOnCourt } from "../src/lib/open-play-core";
import { manilaToUtc } from "../src/lib/time";

const day = "2026-10-15";
const at = (h: number, m = 0) => manilaToUtc(day, h * 60 + m);
const session = { sessionStart: at(18), sessionEnd: at(21) }; // 6–9 PM

test("charges at least 1 hour, with a 10-minute grace", () => {
  assert.equal(hoursToCharge({ ...session, checkedInAt: at(18), checkedOutAt: at(18, 20) }), 1);
  assert.equal(hoursToCharge({ ...session, checkedInAt: at(18), checkedOutAt: at(19, 10) }), 1);
  assert.equal(hoursToCharge({ ...session, checkedInAt: at(18), checkedOutAt: at(19, 11) }), 2);
  assert.equal(hoursToCharge({ ...session, checkedInAt: at(18, 30), checkedOutAt: at(20, 30) }), 2);
});

test("only counts time inside the session", () => {
  // arrived early, staff forgot to check out until 10 PM: still 3 hours max
  assert.equal(hoursToCharge({ ...session, checkedInAt: at(17, 30), checkedOutAt: at(22) }), 3);
});

test("fee is hours × rate", () => {
  assert.equal(feeCentavos(2, 5000), 10000);
  assert.equal(feeCentavos(3, 0), 0);
});

test("first 4 in line go on court; fewer than 4 waiting means no game", () => {
  const line = [5, 2, 9, 1, 7].map((pos) => ({ id: `p${pos}`, queuePos: pos }));
  assert.deepEqual(nextOnCourt(line)?.map((p) => p.id), ["p1", "p2", "p5", "p7"]);
  assert.equal(nextOnCourt(line.slice(0, 3)), null);
});

test("after a game all 4 go to the back of the line, in the same order", () => {
  const onCourt = [{ id: "c", queuePos: 3 }, { id: "a", queuePos: 1 }, { id: "d", queuePos: 4 }, { id: "b", queuePos: 2 }];
  assert.deepEqual(backOfLine(onCourt, 10), [
    { id: "a", queuePos: 11 }, { id: "b", queuePos: 12 }, { id: "c", queuePos: 13 }, { id: "d", queuePos: 14 },
  ]);
});

test("a full rotation gives everyone the same number of games", () => {
  let line = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, queuePos: i + 1 }));
  const played = new Map<string, number>();
  for (let game = 0; game < 10; game++) {
    const court = nextOnCourt(line)!;
    court.forEach((p) => played.set(p.id, (played.get(p.id) ?? 0) + 1));
    const last = Math.max(...line.map((p) => p.queuePos));
    const moved = new Map(backOfLine(court, last).map((m) => [m.id, m.queuePos]));
    line = line.map((p) => ({ ...p, queuePos: moved.get(p.id) ?? p.queuePos }));
  }
  // 10 games × 4 spots = 40 turns over 10 players: exactly 4 each
  assert.deepEqual([...new Set(played.values())], [4]);
});

test("games until your turn", () => {
  assert.equal(gamesUntilTurn(1), 1);
  assert.equal(gamesUntilTurn(4), 1);
  assert.equal(gamesUntilTurn(5), 2);
});
