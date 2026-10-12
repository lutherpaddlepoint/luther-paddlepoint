// Pickleball side-out scoring and the leaderboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  call, courtOrder, endsSwitched, isGamePoint, justReachedSwitch, newGame, rally, standings, tvOrder, type ScoreState, type Team,
} from "../src/lib/scoring-core";

const play = (seq: string, target = 11, s: ScoreState = newGame()) =>
  [...seq].reduce((st, t) => rally(st, t as Team, target), s);

test("game starts 0-0-2: first fault is an immediate side out", () => {
  const s = newGame();
  assert.equal(call(s), "0-0-2");
  const after = rally(s, "B", 11);
  assert.equal(after.serving, "B");
  assert.equal(after.server, 1);
  assert.equal(call(after), "0-0-1");
});

test("only the serving team scores", () => {
  const s = play("AA"); // A serves and wins twice
  assert.equal(s.scoreA, 2);
  assert.equal(call(s), "2-0-2");
  const t = rally(s, "B", 11); // B wins the rally while A serves: no point for B
  assert.equal(t.scoreB, 0);
});

test("server 1 loses the rally: partner serves; server 2 loses: side out", () => {
  let s = play("B"); // side out to B, server 1
  s = rally(s, "A", 11); // B server 1 faults
  assert.deepEqual([s.serving, s.server], ["B", 2]);
  s = rally(s, "A", 11); // B server 2 faults
  assert.deepEqual([s.serving, s.server], ["A", 1]);
});

test("game to 11, win by 2", () => {
  const s = play("A".repeat(11));
  assert.equal(s.winner, "A");
  assert.equal(s.scoreA, 11);
  // 10-10 then it has to go to 12
  let t: ScoreState = { scoreA: 10, scoreB: 10, serving: "A", server: 1, winner: null, rallies: 0 };
  t = rally(t, "A", 11);
  assert.equal(t.winner, null, "11-10 is not a win");
  t = rally(t, "A", 11);
  assert.equal(t.winner, "A", "12-10 wins");
});

test("games to 15 and 21", () => {
  assert.equal(play("A".repeat(14), 15).winner, null);
  assert.equal(play("A".repeat(15), 15).winner, "A");
  assert.equal(play("A".repeat(21), 21).winner, "A");
});

test("no more points after the game is won", () => {
  const s = play("A".repeat(11));
  assert.deepEqual(rally(s, "A", 11), s);
});

test("switch ends when a team first reaches 6 (game to 11)", () => {
  const five = play("AAAAA");
  const six = rally(five, "A", 11);
  assert.equal(justReachedSwitch(five, six, 11), true);
  assert.equal(justReachedSwitch(six, rally(six, "A", 11), 11), false);
});

test("game point is shown for the serving team only", () => {
  const s: ScoreState = { scoreA: 10, scoreB: 4, serving: "A", server: 1, winner: null, rallies: 0 };
  assert.equal(isGamePoint(s, 11), true);
  assert.equal(isGamePoint({ ...s, serving: "B" }, 11), false);
});

test("leaderboard: wins first, then win %, then point difference; names ignore capitals", () => {
  const rows = standings([
    { teamA: ["Ana", "Ben"], teamB: ["Carlo", "Dina"], winner: "A", scoreA: 11, scoreB: 5 },
    { teamA: ["ANA ", "Carlo"], teamB: ["Ben", "Dina"], winner: "B", scoreA: 9, scoreB: 11 },
  ]);
  const ana = rows.find((r) => r.name === "Ana")!;
  assert.deepEqual([ana.played, ana.wins, ana.losses, ana.pointDiff], [2, 1, 1, 4]);
  assert.equal(rows[0].name, "Ben"); // 2 wins
  assert.deepEqual(rows.map((r) => r.name), ["Ben", "Ana", "Dina", "Carlo"]); // Ana and Dina 1 win each: Ana has the better difference
});

test("TV puts the serving team (or the winner) on the left", () => {
  assert.deepEqual(tvOrder(newGame()), ["A", "B"]);
  const sideOut = play("B"); // B now serving
  assert.deepEqual(tvOrder(sideOut), ["B", "A"]);
  assert.deepEqual(tvOrder({ serving: "A", winner: "B" }), ["B", "A"]);
});

test("referee pad flips once a team reaches the switch point, and flips back on Undo", () => {
  const five = play("AAAAA");
  assert.equal(endsSwitched(five, 11), false);
  assert.deepEqual(courtOrder(endsSwitched(five, 11)), ["A", "B"]);
  const six = rally(five, "A", 11);
  assert.equal(endsSwitched(six, 11), true);
  assert.deepEqual(courtOrder(endsSwitched(six, 11)), ["B", "A"]);
  assert.equal(endsSwitched({ scoreA: 7, scoreB: 0 }, 15), false); // game to 15 switches at 8
  assert.equal(endsSwitched({ scoreA: 8, scoreB: 0 }, 15), true);
});
