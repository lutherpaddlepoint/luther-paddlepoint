// Open play (paddle stacking) rules that need no database, so they can be unit-tested.

export const PLAYERS_PER_GAME = 4; // doubles
export const GRACE_MINUTES = 10; // 1 hr 10 min is still charged as 1 hour

/**
 * Hours to charge one player. Time counts only inside the session (arriving early or
 * being checked out late by staff does not add hours). Any started hour after the grace
 * period counts as a full hour, and everyone pays at least 1 hour.
 */
export function hoursToCharge(args: {
  checkedInAt: Date;
  checkedOutAt: Date;
  sessionStart: Date;
  sessionEnd: Date;
}): number {
  const from = Math.max(args.checkedInAt.getTime(), args.sessionStart.getTime());
  const to = Math.min(args.checkedOutAt.getTime(), args.sessionEnd.getTime());
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  return Math.max(1, Math.ceil((minutes - GRACE_MINUTES) / 60));
}

export const feeCentavos = (hours: number, rateCentavosPerHour: number) => hours * rateCentavosPerHour;

type Positioned = { id: string; queuePos: number };

/** The next players to go on court: the first 4 in line, or null if fewer than 4 are waiting. */
export function nextOnCourt<T extends Positioned>(queued: T[]): T[] | null {
  const line = [...queued].sort((a, b) => a.queuePos - b.queuePos);
  return line.length >= PLAYERS_PER_GAME ? line.slice(0, PLAYERS_PER_GAME) : null;
}

/** After a game, the players on court go to the back of the line, keeping their order. */
export function backOfLine<T extends Positioned>(onCourt: T[], lastPos: number): { id: string; queuePos: number }[] {
  return [...onCourt]
    .sort((a, b) => a.queuePos - b.queuePos)
    .map((p, i) => ({ id: p.id, queuePos: lastPos + 1 + i }));
}

/** Rough wait for someone at a given place in line (1 = next up), from the average game length. */
export function gamesUntilTurn(placeInLine: number): number {
  return Math.ceil(placeInLine / PLAYERS_PER_GAME);
}
