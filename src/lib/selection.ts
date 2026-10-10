// How tapping court slots works: customers build one continuous block of hours.
// Tap an empty slot to start; tap the slot right before or after to extend;
// tap an end of the block to shrink it; tap anywhere else to start over.

export type Range = { start: number; end: number } | null; // minutes, end exclusive

export function toggleSlot(
  range: Range,
  slotStart: number,
  isAvailable: (startMinute: number) => boolean,
): Range {
  if (!isAvailable(slotStart)) return range;
  const slotEnd = slotStart + 60;

  if (!range) return { start: slotStart, end: slotEnd };

  const inside = slotStart >= range.start && slotStart < range.end;
  if (inside) {
    if (range.end - range.start === 60) return null; // tapping the only slot clears it
    if (slotStart === range.start) return { start: range.start + 60, end: range.end };
    if (slotEnd === range.end) return { start: range.start, end: range.end - 60 };
    return { start: slotStart, end: slotEnd }; // tapped the middle: start over there
  }

  if (slotStart === range.end) return { start: range.start, end: slotEnd };
  if (slotEnd === range.start) return { start: slotStart, end: range.end };
  return { start: slotStart, end: slotEnd };
}

/** True when every hour in the range is still available (e.g. after a refresh). */
export function rangeStillAvailable(range: Range, isAvailable: (m: number) => boolean) {
  if (!range) return false;
  for (let m = range.start; m < range.end; m += 60) if (!isAvailable(m)) return false;
  return true;
}
