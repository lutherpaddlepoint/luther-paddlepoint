// Courts (there can be more than one). Server-side helpers.
import { prisma } from "./db";
import { courtNumber, shortCourtName } from "./courts-core";

export type CourtInfo = { id: string; name: string; short: string; number: number };

/** Active courts in name order: Court 1, Court 2, ... */
export async function listCourts(): Promise<CourtInfo[]> {
  const rows = await prisma.amenity.findMany({ where: { type: "COURT", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return rows.map((c, i) => ({ id: c.id, name: c.name, short: shortCourtName(c.name), number: courtNumber(c.name, i) }));
}

/** The court for a "?court=2" link (by number), or the first court. */
export async function courtFromParam(param: string | string[] | undefined): Promise<{ court: CourtInfo | null; courts: CourtInfo[] }> {
  const courts = await listCourts();
  const n = Number(Array.isArray(param) ? param[0] : param);
  const court = (Number.isInteger(n) ? courts.find((c) => c.number === n) : undefined) ?? courts[0] ?? null;
  return { court, courts };
}
