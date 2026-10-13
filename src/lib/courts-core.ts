// Small helpers for having more than one court. No database access, so the browser can use them.

/** Short name for screens: "Pickleball Court 2" -> "Court 2". */
export const shortCourtName = (name: string) => name.replace(/^pickleball\s+/i, "").trim() || name;

/** "Court 2" -> 2. Used for /score?court=2 and similar links. Falls back to the position in the list. */
export function courtNumber(name: string, index = 0): number {
  const m = /(\d+)\s*$/.exec(name);
  return m ? Number(m[1]) : index + 1;
}

/** Lowest and highest hourly price, e.g. "₱200 to ₱250". */
export function priceRange(prices: number[]): [number, number] | null {
  if (!prices.length) return null;
  return [Math.min(...prices), Math.max(...prices)];
}
