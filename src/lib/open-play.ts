// Open play (paddle stacking): sessions, the line of players, games and check-out.
// Every change locks the session row first, so two staff phones tapping at the same time
// can never put the same player on court twice or skip someone in line.
import { Prisma, type PaymentMethod } from "@prisma/client";
import { prisma } from "./db";
import { AdminError, cancelBooking, createCourtBlock } from "./admin-ops";
import { normalizeGcashRef } from "./payment-core";
import { normalizePhMobile } from "./phone";
import { formatMinute, manilaToUtc, todayInManila } from "./time";
import { backOfLine, feeCentavos, hoursToCharge, nextOnCourt, PLAYERS_PER_GAME } from "./open-play-core";
import type { SessionUser } from "./auth";

type Tx = Prisma.TransactionClient;

const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);
export const sessionDate = (s: { date: Date }) => s.date.toISOString().slice(0, 10);
export const sessionStartAt = (s: { date: Date; startMinute: number }) => manilaToUtc(sessionDate(s), s.startMinute);
export const sessionEndAt = (s: { date: Date; endMinute: number }) => manilaToUtc(sessionDate(s), s.endMinute);

const log = (tx: Tx, user: SessionUser, action: string, entityId: string, details?: Prisma.InputJsonValue) =>
  tx.auditLog.create({ data: { action, entity: "open_play", entityId, userId: user.id, details } });

/** Locks the session for the rest of the transaction and returns it. */
async function lockSession(tx: Tx, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "open_play_sessions" WHERE id = ${sessionId}::uuid FOR UPDATE`;
  const s = await tx.openPlaySession.findUnique({ where: { id: sessionId } });
  if (!s) throw new AdminError("Open play session not found.");
  return s;
}

async function lockPlayer(tx: Tx, playerId: string) {
  const p = await tx.openPlayPlayer.findUnique({ where: { id: playerId }, select: { sessionId: true } });
  if (!p) throw new AdminError("Player not found.");
  const session = await lockSession(tx, p.sessionId);
  const player = await tx.openPlayPlayer.findUniqueOrThrow({ where: { id: playerId } });
  return { session, player };
}

async function lastPos(tx: Tx, sessionId: string) {
  const r = await tx.openPlayPlayer.aggregate({ where: { sessionId }, _max: { queuePos: true } });
  return r._max.queuePos ?? 0;
}

// ---------------------------------------------------------------- sessions

export type NewOpenPlay = {
  date: string;
  startMinute: number;
  endMinute: number;
  rateCentavosPerHour: number;
  maxPlayers: number;
  notes?: string;
};

export async function createOpenPlay(input: NewOpenPlay, user: SessionUser) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new AdminError("Pick a date.");
  if (input.date < todayInManila()) throw new AdminError("That date has passed.");
  if (!Number.isInteger(input.rateCentavosPerHour) || input.rateCentavosPerHour < 0)
    throw new AdminError("Enter the price per hour (0 for free).");
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < PLAYERS_PER_GAME || input.maxPlayers > 60)
    throw new AdminError(`Maximum players must be between ${PLAYERS_PER_GAME} and 60.`);
  if (input.date === todayInManila() && manilaToUtc(input.date, input.endMinute) <= new Date())
    throw new AdminError("That time has already passed today.");

  // Block the court first; this fails with a clear message if someone already booked those hours.
  const label = `Open play${input.notes?.trim() ? `: ${input.notes.trim()}` : ""}`;
  const block = await createCourtBlock(input.date, input.startMinute, input.endMinute, label, user);
  try {
    return await prisma.$transaction(async (tx) => {
      const s = await tx.openPlaySession.create({
        data: {
          date: dateOnly(input.date), startMinute: input.startMinute, endMinute: input.endMinute,
          rateCentavosPerHour: input.rateCentavosPerHour, maxPlayers: input.maxPlayers,
          notes: input.notes?.trim() || null, blockBookingId: block.id, createdById: user.id,
        },
      });
      await log(tx, user, "OPEN_PLAY_CREATED", s.id, { ...input });
      return s;
    });
  } catch (e) {
    await cancelBooking(block.id, "Open play could not be saved", user).catch(() => undefined);
    throw e;
  }
}

/** Cancels a session nobody has checked in to yet, and opens the court for bookings again. */
export async function cancelOpenPlay(sessionId: string, user: SessionUser) {
  const blockId = await prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status !== "SCHEDULED") throw new AdminError("This session is already closed or cancelled.");
    const players = await tx.openPlayPlayer.count({ where: { sessionId } });
    if (players > 0) throw new AdminError("Players already checked in. Check everyone out and close the session instead.");
    await tx.openPlaySession.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });
    await log(tx, user, "OPEN_PLAY_CANCELLED", sessionId);
    return s.blockBookingId;
  });
  if (blockId) await cancelBooking(blockId, "Open play cancelled", user).catch(() => undefined);
}

/** Ends the session once everyone is checked out. */
export async function closeOpenPlay(sessionId: string, user: SessionUser) {
  await prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status !== "SCHEDULED") throw new AdminError("This session is already closed or cancelled.");
    const active = await tx.openPlayPlayer.count({ where: { sessionId, state: { not: "OUT" } } });
    if (active > 0) throw new AdminError(`${active} player(s) are still checked in. Check them out first.`);
    await tx.openPlaySession.update({ where: { id: sessionId }, data: { status: "CLOSED" } });
    await log(tx, user, "OPEN_PLAY_CLOSED", sessionId);
  });
}

// ---------------------------------------------------------------- players and games

export async function addPlayer(sessionId: string, name: string, mobileRaw: string, user: SessionUser) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 1 || clean.length > 30) throw new AdminError("Enter the player's name or nickname (up to 30 letters).");
  let mobile: string | null = null;
  if (mobileRaw.trim()) {
    mobile = normalizePhMobile(mobileRaw);
    if (!mobile) throw new AdminError("That mobile number doesn't look right. Leave it blank if not needed.");
  }
  return prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status !== "SCHEDULED") throw new AdminError("This session is closed.");
    if (sessionDate(s) !== todayInManila()) throw new AdminError("Players can only be added on the day of the session.");
    const active = await tx.openPlayPlayer.count({ where: { sessionId, state: { not: "OUT" } } });
    if (active >= s.maxPlayers) throw new AdminError(`Full: ${s.maxPlayers} players are already checked in.`);
    const same = await tx.openPlayPlayer.count({
      where: { sessionId, state: { not: "OUT" }, name: { equals: clean, mode: "insensitive" } },
    });
    if (same > 0) throw new AdminError(`"${clean}" is already in this session. Add a last name or initial to tell them apart.`);
    const p = await tx.openPlayPlayer.create({
      data: { sessionId, name: clean, mobile, queuePos: (await lastPos(tx, sessionId)) + 1 },
    });
    await log(tx, user, "OPEN_PLAY_PLAYER_ADDED", sessionId, { player: clean });
    return p;
  });
}

async function startGame(tx: Tx, sessionId: string) {
  const queued = await tx.openPlayPlayer.findMany({ where: { sessionId, state: "QUEUED" } });
  const next = nextOnCourt(queued);
  if (!next) return null;
  await tx.openPlayPlayer.updateMany({ where: { id: { in: next.map((p) => p.id) } }, data: { state: "PLAYING" } });
  return next;
}

/** Puts the next 4 in line on court. */
export async function startNextGame(sessionId: string, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status !== "SCHEDULED") throw new AdminError("This session is closed.");
    const playing = await tx.openPlayPlayer.count({ where: { sessionId, state: "PLAYING" } });
    if (playing > 0) throw new AdminError("A game is still on court. Tap “Game over” first.");
    const next = await startGame(tx, sessionId);
    if (!next) throw new AdminError(`Need at least ${PLAYERS_PER_GAME} players in line to start a game.`);
    await log(tx, user, "OPEN_PLAY_GAME_STARTED", sessionId, { players: next.map((p) => p.name) });
    return next;
  });
}

/** Game over: the players on court go to the back of the line, then (optionally) the next 4 go on. */
export async function finishGame(sessionId: string, startNext: boolean, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, sessionId);
    if (s.status !== "SCHEDULED") throw new AdminError("This session is closed.");
    const onCourt = await tx.openPlayPlayer.findMany({ where: { sessionId, state: "PLAYING" } });
    if (onCourt.length === 0) throw new AdminError("No game is on court right now.");
    const moves = backOfLine(onCourt, await lastPos(tx, sessionId));
    for (const m of moves) {
      await tx.openPlayPlayer.update({
        where: { id: m.id }, data: { state: "QUEUED", queuePos: m.queuePos, gamesPlayed: { increment: 1 } },
      });
    }
    await tx.openPlaySession.update({ where: { id: sessionId }, data: { gamesPlayed: { increment: 1 } } });
    const next = startNext ? await startGame(tx, sessionId) : null;
    await log(tx, user, "OPEN_PLAY_GAME_FINISHED", sessionId, {
      finished: onCourt.map((p) => p.name), next: next?.map((p) => p.name) ?? null,
    });
    return { next };
  });
}

/** Sends a waiting player to the back of the line (e.g. they asked to wait a game). */
export async function moveToBack(playerId: string, user: SessionUser) {
  await prisma.$transaction(async (tx) => {
    const { session, player } = await lockPlayer(tx, playerId);
    if (player.state !== "QUEUED") throw new AdminError("Only players waiting in line can be moved.");
    await tx.openPlayPlayer.update({ where: { id: playerId }, data: { queuePos: (await lastPos(tx, session.id)) + 1 } });
    await log(tx, user, "OPEN_PLAY_MOVED_TO_BACK", session.id, { player: player.name });
  });
}

/** Takes a player out of line to rest, or puts a resting player back at the end of the line. */
export async function setResting(playerId: string, resting: boolean, user: SessionUser) {
  await prisma.$transaction(async (tx) => {
    const { session, player } = await lockPlayer(tx, playerId);
    if (resting && player.state !== "QUEUED") throw new AdminError("Only players waiting in line can rest.");
    if (!resting && player.state !== "RESTING") throw new AdminError("This player is not resting.");
    await tx.openPlayPlayer.update({
      where: { id: playerId },
      data: resting ? { state: "RESTING" } : { state: "QUEUED", queuePos: (await lastPos(tx, session.id)) + 1 },
    });
    await log(tx, user, resting ? "OPEN_PLAY_RESTING" : "OPEN_PLAY_BACK_IN_LINE", session.id, { player: player.name });
  });
}

/** What a player owes if checked out at `at` (used for the live amount on the screen too). */
export function amountDue(
  session: { date: Date; startMinute: number; endMinute: number; rateCentavosPerHour: number },
  player: { checkedInAt: Date },
  at: Date = new Date(),
) {
  const hours = hoursToCharge({
    checkedInAt: player.checkedInAt, checkedOutAt: at,
    sessionStart: sessionStartAt(session), sessionEnd: sessionEndAt(session),
  });
  return { hours, centavos: feeCentavos(hours, session.rateCentavosPerHour) };
}

/**
 * Checks a player out and records what they paid. If they leave in the middle of a game,
 * the first person in line takes their place on court.
 */
export async function checkOutPlayer(
  playerId: string, method: PaymentMethod | null, gcashRefRaw: string, user: SessionUser,
) {
  return prisma.$transaction(async (tx) => {
    const { session, player } = await lockPlayer(tx, playerId);
    if (player.state === "OUT") throw new AdminError("Already checked out.");
    const now = new Date();
    const due = amountDue(session, player, now);
    let gcashReference: string | null = null;
    if (due.centavos > 0) {
      if (method !== "CASH" && method !== "GCASH_MANUAL") throw new AdminError("Choose how they paid: cash or GCash.");
      if (method === "GCASH_MANUAL") {
        gcashReference = normalizeGcashRef(gcashRefRaw);
        if (!gcashReference) throw new AdminError("Enter the GCash Ref. No. from their receipt.");
      }
    }
    await tx.openPlayPlayer.update({
      where: { id: playerId },
      data: {
        state: "OUT", checkedOutAt: now, hoursCharged: due.hours, amountCentavos: due.centavos,
        paymentMethod: due.centavos > 0 ? method : null, gcashReference,
      },
    });
    let substitute: string | null = null;
    if (player.state === "PLAYING") {
      const queued = await tx.openPlayPlayer.findMany({ where: { sessionId: session.id, state: "QUEUED" }, orderBy: { queuePos: "asc" }, take: 1 });
      if (queued[0]) {
        await tx.openPlayPlayer.update({ where: { id: queued[0].id }, data: { state: "PLAYING" } });
        substitute = queued[0].name;
      }
    }
    await log(tx, user, "OPEN_PLAY_CHECKED_OUT", session.id, {
      player: player.name, hours: due.hours, amountCentavos: due.centavos, method, substitute,
    });
    return { ...due, name: player.name, substitute };
  });
}

// ---------------------------------------------------------------- reading

export async function listOpenPlay(fromDate: string) {
  return prisma.openPlaySession.findMany({
    where: { date: { gte: dateOnly(fromDate) }, status: { not: "CANCELLED" } },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    include: { _count: { select: { players: true } } },
    take: 50,
  });
}

export async function openPlayBoard(sessionId: string) {
  const s = await prisma.openPlaySession.findUnique({
    where: { id: sessionId },
    include: { players: { orderBy: { queuePos: "asc" } } },
  });
  if (!s) return null;
  return {
    session: s,
    onCourt: s.players.filter((p) => p.state === "PLAYING"),
    line: s.players.filter((p) => p.state === "QUEUED"),
    resting: s.players.filter((p) => p.state === "RESTING"),
    out: s.players.filter((p) => p.state === "OUT").sort((a, b) => +b.checkedOutAt! - +a.checkedOutAt!),
  };
}

/** The session the public screen should show: today's, the one running now or the next one later today. */
export async function currentPublicSession() {
  const today = todayInManila();
  const sessions = await prisma.openPlaySession.findMany({
    where: { date: dateOnly(today), status: "SCHEDULED" },
    orderBy: { startMinute: "asc" },
  });
  const now = Date.now();
  return sessions.find((s) => sessionEndAt(s).getTime() > now) ?? sessions.at(-1) ?? null;
}

export async function upcomingPublicSessions(limit = 6) {
  return prisma.openPlaySession.findMany({
    where: { date: { gte: dateOnly(todayInManila()) }, status: "SCHEDULED" },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    take: limit,
  });
}

export const sessionLabel = (s: { date: Date; startMinute: number; endMinute: number }) => {
  const d = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" })
    .format(manilaToUtc(sessionDate(s), 720));
  return `${d}, ${formatMinute(s.startMinute)}–${formatMinute(s.endMinute)}`;
};

/** Open play money collected between two Manila dates (inclusive), for the Reports page. */
export async function openPlayTotals(from: string, to: string) {
  const rows = await prisma.openPlayPlayer.groupBy({
    by: ["paymentMethod"],
    where: { state: "OUT", checkedOutAt: { gte: manilaToUtc(from, 0), lt: manilaToUtc(to, 1440) } },
    _sum: { amountCentavos: true },
    _count: { _all: true },
  });
  const sum = (m: PaymentMethod | null) => rows.find((r) => r.paymentMethod === m)?._sum.amountCentavos ?? 0;
  return {
    total: rows.reduce((t, r) => t + (r._sum.amountCentavos ?? 0), 0),
    cash: sum("CASH"),
    gcash: sum("GCASH_MANUAL"),
    players: rows.reduce((t, r) => t + r._count._all, 0),
  };
}

