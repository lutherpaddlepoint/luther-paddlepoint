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

/** Before there were two courts, the single referee link was stored under this key (it now belongs to the first court). */
const LEGACY_TOKEN_KEY = "referee_token";
const tokenKey = (courtId: string) => `referee_token:${courtId}`;
const HISTORY_LIMIT = 200;

const firstCourtId = async () =>
  (await prisma.amenity.findFirst({ where: { type: "COURT", isActive: true }, orderBy: { name: "asc" }, select: { id: true } }))?.id ?? null;

// ---------------------------------------------------------------- referee links (one per court)

export async function getRefereeToken(courtId: string): Promise<string> {
  const key = tokenKey(courtId);
  const row = await prisma.setting.findUnique({ where: { key } });
  if (typeof row?.value === "string" && row.value.length >= 16) return row.value;
  // The first court keeps the link (and printed QR) it had before Court 2 was added.
  let token = randomBytes(12).toString("base64url");
  if (courtId === (await firstCourtId())) {
    const legacy = await prisma.setting.findUnique({ where: { key: LEGACY_TOKEN_KEY } });
    if (typeof legacy?.value === "string" && legacy.value.length >= 16) token = legacy.value;
  }
  await prisma.setting.upsert({ where: { key }, create: { key, value: token }, update: {} });
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key } });
  return saved.value as string;
}

/** Makes a new referee link for one court; that court's old link stops working. */
export async function newRefereeToken(courtId: string, user: SessionUser) {
  const key = tokenKey(courtId);
  const token = randomBytes(12).toString("base64url");
  const isFirst = courtId === (await firstCourtId());
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key }, create: { key, value: token }, update: { value: token } }),
    // For the first court, the old shared link must stop working too.
    ...(isFirst ? [prisma.setting.deleteMany({ where: { key: LEGACY_TOKEN_KEY } })] : []),
    prisma.auditLog.create({ data: { action: "REFEREE_LINK_RESET", entity: "setting", entityId: key, userId: user.id } }),
  ]);
  return token;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a ?? "");
  const y = Buffer.from(b ?? "");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Which court a referee link belongs to, or null if the link isn't valid. */
export async function refereeCourt(token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "referee_token:" } } });
  for (const r of rows) if (typeof r.value === "string" && same(token, r.value)) return r.key.slice("referee_token:".length);
  // Old single link (before per-court links were created) = first court.
  const legacy = await prisma.setting.findUnique({ where: { key: LEGACY_TOKEN_KEY } });
  if (typeof legacy?.value === "string" && same(token, legacy.value)) {
    const first = await firstCourtId();
    if (first && !rows.some((r) => r.key === tokenKey(first))) return first;
  }
  return null;
}

export async function isValidRefereeToken(token: string): Promise<boolean> {
  return (await refereeCourt(token)) !== null;
}

async function requireReferee(token: string): Promise<string> {
  const courtId = await refereeCourt(token);
  if (!courtId) throw new ScoreError("This referee link is no longer valid. Ask the staff for the new one.");
  return courtId;
}

// ---------------------------------------------------------------- reading

const historyOf = (m: Match) => (Array.isArray(m.history) ? (m.history as unknown as ScoreState[]) : []);

/** The match being scored on a court right now (or on any court, if no court is given). */
export const liveMatch = (courtId?: string | null) =>
  prisma.match.findFirst({ where: { status: "LIVE", ...(courtId ? { amenityId: courtId } : {}) }, orderBy: { startedAt: "asc" } });

export const liveMatches = () => prisma.match.findMany({ where: { status: "LIVE" }, include: { amenity: { select: { name: true } } } });

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

export const recentMatches = (take = 20, courtId?: string | null) =>
  prisma.match.findMany({
    where: { status: "FINISHED", ...(courtId ? { amenityId: courtId } : {}) },
    orderBy: { finishedAt: "desc" }, take,
    include: { amenity: { select: { name: true } } },
  });

// ---------------------------------------------------------------- starting a match

const cleanNames = (names: string[]) => names.map((n) => n.trim().replace(/\s+/g, " ").slice(0, 30));

function checkTarget(target: number) {
  if (!(TARGETS as readonly number[]).includes(target)) throw new ScoreError("Choose a game to 11, 15 or 21.");
}

/** Quick match (court bookings, or any time): names are typed by the referee. */
export async function startQuickMatch(token: string, teamA: string[], teamB: string[], target: number) {
  const courtId = await requireReferee(token);
  checkTarget(target);
  const a = cleanNames(teamA);
  const b = cleanNames(teamB);
  const names = [...a, ...b];
  if (names.some((n) => !n)) throw new ScoreError("Enter all 4 player names (or nicknames).");
  return createMatch({ amenityId: courtId, teamA: a, teamB: b, target });
}

/**
 * Open play: scores the 4 players on court now. `pairing` picks partners from the
 * on-court order: 0 = 1&2 vs 3&4, 1 = 1&3 vs 2&4, 2 = 1&4 vs 2&3.
 */
export async function startOpenPlayMatch(token: string, openPlaySessionId: string, pairing: number, target: number) {
  const courtId = await requireReferee(token);
  checkTarget(target);
  const session = await prisma.openPlaySession.findUnique({ where: { id: openPlaySessionId }, select: { amenityId: true } });
  if (!session || session.amenityId !== courtId) throw new ScoreError("This open play session is on another court. Use that court's referee link.");
  const onCourt = await prisma.openPlayPlayer.findMany({
    where: { sessionId: openPlaySessionId, state: "PLAYING" }, orderBy: { queuePos: "asc" },
  });
  if (onCourt.length !== 4) throw new ScoreError("Open play needs 4 players on court. Ask the staff to start the game first.");
  const [p1, p2, p3, p4] = onCourt;
  const pairs = [[[p1, p2], [p3, p4]], [[p1, p3], [p2, p4]], [[p1, p4], [p2, p3]]][pairing] ?? [[p1, p2], [p3, p4]];
  const [A, B] = pairs;
  return createMatch({
    amenityId: courtId, openPlaySessionId, target,
    teamA: A.map((p) => p.name), teamB: B.map((p) => p.name),
    teamAPlayerIds: A.map((p) => p.id), teamBPlayerIds: B.map((p) => p.id),
  });
}

async function createMatch(data: {
  amenityId: string; teamA: string[]; teamB: string[]; target: number;
  openPlaySessionId?: string; teamAPlayerIds?: string[]; teamBPlayerIds?: string[];
}) {
  const s = newGame("A");
  try {
    return await prisma.match.create({
      data: { ...data, scoreA: s.scoreA, scoreB: s.scoreB, serving: s.serving, server: s.server, rallies: 0 },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new ScoreError("A match is already being scored on this court. Finish or cancel it first.");
    throw e;
  }
}

// ---------------------------------------------------------------- scoring

async function lockMatch(tx: Tx, matchId: string, courtId?: string) {
  await tx.$queryRaw`SELECT id FROM "matches" WHERE id = ${matchId}::uuid FOR UPDATE`;
  const m = await tx.match.findUnique({ where: { id: matchId } });
  if (!m) throw new ScoreError("Match not found.");
  // A referee link only works for matches on its own court.
  if (courtId && m.amenityId !== courtId) throw new ScoreError("This match is on another court.");
  return m;
}


/** The referee taps which team won the rally. */
export async function recordRally(token: string, matchId: string, wonBy: Team) {
  const courtId = await requireReferee(token);
  if (wonBy !== "A" && wonBy !== "B") throw new ScoreError("Unknown team.");
  return prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId, courtId);
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
  const courtId = await requireReferee(token);
  return prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId, courtId);
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
  const courtId = await requireReferee(token);
  const m = await prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId, courtId);
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
  const courtId = await requireReferee(token);
  await prisma.$transaction(async (tx) => {
    const m = await lockMatch(tx, matchId, courtId);
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
