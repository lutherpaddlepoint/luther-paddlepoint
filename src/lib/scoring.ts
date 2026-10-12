// Scoreboard: live match, referee actions, results and leaderboard.
// The referee uses a secret link (no login). Every change locks the match row, so two
// taps arriving at once are applied one after the other, never lost or doubled.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type Match } from "@prisma/client";
import { prisma } from "./db";
import { finishGame } from "./open-play";
import {
  call, endsSwitched, isGamePoint, justReachedSwitch, newGame, rally, standings, TARGETS, type FinishedMatch, type ScoreState, type Team,
} from "./scoring-core";
import type { SessionUser } from "./auth";

export class ScoreError extends Error {}
type Tx = Prisma.TransactionClient;

const TOKEN_KEY = "referee_token";
const HISTORY_LIMIT = 200;

// ---------------------------------------------------------------- referee link

export async function getRefereeToken(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: TOKEN_KEY } });
  if (typeof row?.value === "string" && row.value.length >= 16) return row.value;
  const token = randomBytes(12).toString("base64url");
  await prisma.setting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: token }, update: {} });
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key: TOKEN_KEY } });
  return saved.value as string;
}

/** Makes a new referee link; the old one stops working. */
export async function newRefereeToken(user: SessionUser) {
  const token = randomBytes(12).toString("base64url");
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: token }, update: { value: token } }),
    prisma.auditLog.create({ data: { action: "REFEREE_LINK_RESET", entity: "setting", entityId: TOKEN_KEY, userId: user.id } }),
  ]);
  return token;
}

export async function isValidRefereeToken(token: string): Promise<boolean> {
  const real = await getRefereeToken();
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requireReferee(token: string) {
  if (!(await isValidRefereeToken(token))) throw new ScoreError("This referee link is no longer valid. Ask the staff for the new one.");
}

// ---------------------------------------------------------------- reading

const historyOf = (m: Match) => (Array.isArray(m.history) ? (m.history as unknown as ScoreState[]) : []);

export const liveMatch = () => prisma.match.findFirst({ where: { status: "LIVE" } });

export const stateOf = (m: Match): ScoreState => ({
  scoreA: m.scoreA, scoreB: m.scoreB, serving: m.serving as Team, server: m.server as 1 | 2,
  winner: (m.winner as Team | null) ?? null, rallies: m.rallies,
});

export const callOf = (m: Match) => call(stateOf(m));

/** Everything a scoreboard screen needs (no secrets). */
export function matchView(m: Match) {
  const st = stateOf(m);
  const hist = historyOf(m);
  const prev = hist.at(-1);
  return {
    id: m.id, teamA: m.teamA, teamB: m.teamB, scoreA: m.scoreA, scoreB: m.scoreB,
    serving: st.serving, server: m.server, winner: st.winner, target: m.target,
    call: call(st), gamePoint: isGamePoint(st, m.target),
    switchSides: !!prev && justReachedSwitch(prev, st, m.target),
    switched: endsSwitched(st, m.target),
    canUndo: hist.length > 0, openPlay: !!m.openPlaySessionId,
  };
}
export type MatchView = ReturnType<typeof matchView>;

const toFinished = (m: Match): FinishedMatch => ({
  teamA: m.teamA, teamB: m.teamB, winner: m.winner as Team, scoreA: m.scoreA, scoreB: m.scoreB,
});

export async function sessionStandings(openPlaySessionId: string) {
  const matches = await prisma.match.findMany({ where: { openPlaySessionId, status: "FINISHED", winner: { not: null } } });
  return standings(matches.map(toFinished));
}

export async function periodStandings(from: Date, to: Date) {
  const matches = await prisma.match.findMany({ where: { status: "FINISHED", winner: { not: null }, finishedAt: { gte: from, lt: to } } });
  return { rows: standings(matches.map(toFinished)), matches: matches.length };
}

export const recentMatches = (take = 20) =>
  prisma.match.findMany({ where: { status: "FINISHED" }, orderBy: { finishedAt: "desc" }, take });

// ---------------------------------------------------------------- starting a match

const cleanNames = (names: string[]) => names.map((n) => n.trim().replace(/\s+/g, " ").slice(0, 30));

function checkTarget(target: number) {
  if (!(TARGETS as readonly number[]).includes(target)) throw new ScoreError("Choose a game to 11, 15 or 21.");
}

/** Quick match (court bookings, or any time): names are typed by the referee. */
export async function startQuickMatch(token: string, teamA: string[], teamB: string[], target: number) {
  await requireReferee(token);
  checkTarget(target);
  const a = cleanNames(teamA);
  const b = cleanNames(teamB);
  const names = [...a, ...b];
  if (names.some((n) => !n)) throw new ScoreError("Enter all 4 player names (or nicknames).");
  return createMatch({ teamA: a, teamB: b, target });
}

/**
 * Open play: scores the 4 players on court now. `pairing` picks partners from the
 * on-court order: 0 = 1&2 vs 3&4, 1 = 1&3 vs 2&4, 2 = 1&4 vs 2&3.
 */
export async function startOpenPlayMatch(token: string, openPlaySessionId: string, pairing: number, target: number) {
  await requireReferee(token);
  checkTarget(target);
  const onCourt = await prisma.openPlayPlayer.findMany({
    where: { sessionId: openPlaySessionId, state: "PLAYING" }, orderBy: { queuePos: "asc" },
  });
  if (onCourt.length !== 4) throw new ScoreError("Open play needs 4 players on court. Ask the staff to start the game first.");
  const [p1, p2, p3, p4] = onCourt;
  const pairs = [[[p1, p2], [p3, p4]], [[p1, p3], [p2, p4]], [[p1, p4], [p2, p3]]][pairing] ?? [[p1, p2], [p3, p4]];
  const [A, B] = pairs;
  return createMatch({
    openPlaySessionId, target,
    teamA: A.map((p) => p.name), teamB: B.map((p) => p.name),
    teamAPlayerIds: A.map((p) => p.id), teamBPlayerIds: B.map((p) => p.id),
  });
}

async function createMatch(data: {
  teamA: string[]; teamB: string[]; target: number;
  openPlaySessionId?: string; teamAPlayerIds?: string[]; teamBPlayerIds?: string[];
}) {
  const s = newGame("A");
  try {
    return await prisma.match.create({
      data: { ...data, scoreA: s.scoreA, scoreB: s.scoreB, serving: s.serving, server: s.server, rallies: 0 },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new ScoreError("A match is already being scored. Finish or cancel it first.");
    throw e;
  }
}

// ---------------------------------------------------------------- scoring

async function lockMatch(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT id FROM "matches" WHERE id = ${matchId}::uuid FOR UPDATE`;
  const m = await tx.match.findUnique({ where: { id: matchId } });
  if (!m) throw new ScoreError("Match not found.");
  return m;
}


/** The referee taps which team won the rally. */
export async function recordRally(token: string, matchId: string, wonBy: Team) {
  await requireReferee(token);
  if (wonBy !== "A" && wonBy !== "B") throw new ScoreError("Unknown team.");
  return prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId);
    if (m.status !== "LIVE") throw new ScoreError("This match is over.");
    const before = stateOf(m);
    if (before.winner) throw new ScoreError("Game over. Confirm the result, or Undo the last point.");
    const after = rally(before, wonBy, m.target);
    const history = [...historyOf(m), before].slice(-HISTORY_LIMIT);
    return tx.match.update({
      where: { id: m.id },
      data: {
        scoreA: after.scoreA, scoreB: after.scoreB, serving: after.serving, server: after.server,
        winner: after.winner, rallies: after.rallies, history: history as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/** Takes back the last tap. */
export async function undoRally(token: string, matchId: string) {
  await requireReferee(token);
  return prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId);
    if (m.status !== "LIVE") throw new ScoreError("This match is over.");
    const history = historyOf(m);
    const prev = history.pop();
    if (!prev) throw new ScoreError("Nothing to undo.");
    return tx.match.update({
      where: { id: m.id },
      data: {
        scoreA: prev.scoreA, scoreB: prev.scoreB, serving: prev.serving, server: prev.server,
        winner: prev.winner, rallies: prev.rallies, history: history as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Saves the result. For open play, `nextFour` also ends the game in the paddle stack
 * (all 4 to the back of the line) and puts the next 4 on court.
 */
export async function confirmResult(token: string, matchId: string, nextFour: boolean) {
  await requireReferee(token);
  const m = await prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId);
    if (m.status !== "LIVE") throw new ScoreError("This result is already saved.");
    if (!m.winner) throw new ScoreError("The game isn't over yet.");
    return tx.match.update({ where: { id: m.id }, data: { status: "FINISHED", finishedAt: new Date() } });
  });
  let next: string[] | null = null;
  if (m.openPlaySessionId && nextFour && (await sameFourOnCourt(m))) {
    try {
      const r = await finishGame(m.openPlaySessionId, true, null);
      next = r.next?.map((p) => p.name) ?? null;
    } catch {
      // The staff may have already tapped "Game over" in the dashboard; the result is still saved.
    }
  }
  return { match: m, next };
}

/** Only rotate the paddle stack if the players on court are still the ones in this match. */
async function sameFourOnCourt(m: Match) {
  const playing = await prisma.openPlayPlayer.findMany({
    where: { sessionId: m.openPlaySessionId!, state: "PLAYING" }, select: { id: true },
  });
  const ids = new Set(playing.map((p) => p.id));
  const mine = [...m.teamAPlayerIds, ...m.teamBPlayerIds];
  return mine.length === ids.size && mine.every((id) => ids.has(id));
}

/** Cancels a match without a result (wrong players, rain, etc.). */
export async function abandonMatch(token: string, matchId: string) {
  await requireReferee(token);
  await prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId);
    if (m.status !== "LIVE") throw new ScoreError("This match is already over.");
    await tx.match.update({ where: { id: m.id }, data: { status: "ABANDONED", finishedAt: new Date() } });
  });
}

/** Staff can also cancel a stuck match from the dashboard. */
export async function abandonMatchAsStaff(matchId: string, user: SessionUser) {
  await prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId);
    if (m.status !== "LIVE") throw new ScoreError("This match is already over.");
    await tx.match.update({ where: { id: m.id }, data: { status: "ABANDONED", finishedAt: new Date() } });
    await tx.auditLog.create({ data: { action: "MATCH_ABANDONED", entity: "match", entityId: m.id, userId: user.id } });
  });
}
