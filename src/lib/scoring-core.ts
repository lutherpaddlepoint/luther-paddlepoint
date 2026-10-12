// Pickleball doubles scoring, traditional side-out rules. No database, so it can be unit-tested.
//
// - Only the serving team scores.
// - Each team has two serves (server 1, then server 2) before a side out,
//   except at the very start: the first serving team only gets one (the "0-0-2" start).
// - First to the target (11, 15 or 21) wins, but you must win by 2.
// - The score is called as: serving team's score - receiving team's score - server number.

export type Team = "A" | "B";
export const TARGETS = [11, 15, 21] as const;
export type Target = (typeof TARGETS)[number];

export type ScoreState = {
  scoreA: number;
  scoreB: number;
  serving: Team;
  server: 1 | 2;
  winner: Team | null;
  rallies: number;
};

export const other = (t: Team): Team => (t === "A" ? "B" : "A");

/** New game: team A serves first, starting as server 2 (0-0-2). */
export function newGame(firstServe: Team = "A"): ScoreState {
  return { scoreA: 0, scoreB: 0, serving: firstServe, server: 2, winner: null, rallies: 0 };
}

export const scoreOf = (s: ScoreState, t: Team) => (t === "A" ? s.scoreA : s.scoreB);

function winnerOf(s: Pick<ScoreState, "scoreA" | "scoreB">, target: number): Team | null {
  if (s.scoreA >= target && s.scoreA - s.scoreB >= 2) return "A";
  if (s.scoreB >= target && s.scoreB - s.scoreA >= 2) return "B";
  return null;
}

/** The referee says which team won the rally; returns the new state. */
export function rally(s: ScoreState, wonBy: Team, target: number): ScoreState {
  if (s.winner) return s; // game already over
  const next: ScoreState = { ...s, rallies: s.rallies + 1 };
  if (wonBy === s.serving) {
    if (wonBy === "A") next.scoreA += 1;
    else next.scoreB += 1;
    next.winner = winnerOf(next, target);
  } else if (s.server === 1) {
    next.server = 2; // partner serves
  } else {
    next.serving = other(s.serving); // side out
    next.server = 1;
  }
  return next;
}

/** "7-4-2": serving team's score, receiving team's score, server number. */
export function call(s: ScoreState): string {
  return `${scoreOf(s, s.serving)}-${scoreOf(s, other(s.serving))}-${s.server}`;
}

/** Point at which teams switch ends: first team to reach half the target (6 of 11, 8 of 15, 11 of 21). */
export const switchAt = (target: number) => Math.ceil(target / 2);

/** True right after the point that made a team reach the switch score for the first time. */
export function justReachedSwitch(before: ScoreState, after: ScoreState, target: number): boolean {
  const at = switchAt(target);
  const maxBefore = Math.max(before.scoreA, before.scoreB);
  const maxAfter = Math.max(after.scoreA, after.scoreB);
  return maxBefore < at && maxAfter >= at && !after.winner;
}

/** Teams have changed ends once either score reaches the switch point (scores never go down, except by Undo). */
export const endsSwitched = (s: Pick<ScoreState, "scoreA" | "scoreB">, target: number) =>
  Math.max(s.scoreA, s.scoreB) >= switchAt(target);

/** Left-to-right order of the teams on the TV: the serving team (or the winner) on the left. */
export const tvOrder = (s: Pick<ScoreState, "serving" | "winner">): [Team, Team] => {
  const first = s.winner ?? s.serving;
  return [first, other(first)];
};

/** Left-to-right order on the referee's phone: matches the court, so it flips when teams switch ends. */
export const courtOrder = (switched: boolean): [Team, Team] => (switched ? ["B", "A"] : ["A", "B"]);

/** Game point for the team that could win on its next point (only the serving team can score). */
export function isGamePoint(s: ScoreState, target: number): boolean {
  if (s.winner) return false;
  const mine = scoreOf(s, s.serving) + 1;
  const theirs = scoreOf(s, other(s.serving));
  return mine >= target && mine - theirs >= 2;
}

// ---------------------------------------------------------------- leaderboard

export type FinishedMatch = { teamA: string[]; teamB: string[]; winner: Team; scoreA: number; scoreB: number };
export type StandingRow = { name: string; played: number; wins: number; losses: number; pointDiff: number; winPct: number };

/** Names are matched without regard to capital letters or extra spaces ("Ana " = "ANA"). */
export const nameKey = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

export function standings(matches: FinishedMatch[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const row = (name: string) => {
    const k = nameKey(name);
    if (!rows.has(k)) rows.set(k, { name: name.trim(), played: 0, wins: 0, losses: 0, pointDiff: 0, winPct: 0 });
    return rows.get(k)!;
  };
  for (const m of matches) {
    for (const [team, names] of [["A", m.teamA], ["B", m.teamB]] as const) {
      const diff = team === "A" ? m.scoreA - m.scoreB : m.scoreB - m.scoreA;
      for (const n of names) {
        if (!n.trim()) continue;
        const r = row(n);
        r.played += 1;
        if (m.winner === team) r.wins += 1;
        else r.losses += 1;
        r.pointDiff += diff;
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, winPct: r.played ? r.wins / r.played : 0 }))
    .sort((a, b) => b.wins - a.wins || b.winPct - a.winPct || b.pointDiff - a.pointDiff || a.name.localeCompare(b.name));
}
