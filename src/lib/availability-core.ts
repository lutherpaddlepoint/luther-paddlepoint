// Pure availability logic (no database) — shared by the API and tests.

import { appliesOn, type RateRuleInput } from "./pricing";
import { dayOfWeek, formatMinute, manilaToUtc } from "./time";

export type SlotStatus = "available" | "booked" | "blocked" | "past";

export type CourtSlot = {
  startMinute: number;
  endMinute: number;
  label: string; // "4:00 PM"
  rateLabel: string;
  priceCentavos: number;
  isNight: boolean;
  status: SlotStatus;
};

export type BusyRange = { startAt: Date; endAt: Date; kind: "BOOKING" | "BLOCK" };

export function buildCourtSlots(args: {
  date: string;
  now: Date;
  busy: BusyRange[];
  rules: RateRuleInput[];
  openMinute: number;
  closeMinute: number;
  lightsOnMinute: number;
}): CourtSlot[] {
  const { date, now, busy, rules, openMinute, closeMinute, lightsOnMinute } = args;
  const dow = dayOfWeek(date);
  const hourly = rules.filter((r) => r.unit === "PER_HOUR" && appliesOn(r, dow));
  const slots: CourtSlot[] = [];

  for (let m = openMinute; m + 60 <= closeMinute; m += 60) {
    const rule = hourly.find((r) => m >= r.startMinute && m + 60 <= r.endMinute);
    if (!rule) continue; // no price set for this hour = not bookable
    const start = manilaToUtc(date, m);
    const end = manilaToUtc(date, m + 60);
    const hit = busy.find((b) => b.startAt < end && b.endAt > start);

    let status: SlotStatus = "available";
    if (start <= now) status = "past";
    else if (hit) status = hit.kind === "BLOCK" ? "blocked" : "booked";

    slots.push({
      startMinute: m,
      endMinute: m + 60,
      label: formatMinute(m),
      rateLabel: rule.label,
      priceCentavos: rule.priceCentavos,
      isNight: m >= lightsOnMinute,
      status,
    });
  }
  return slots;
}

export type PoolSessionStatus = "available" | "full" | "closed" | "past";

export type PoolSessionView = {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  capacity: number;
  reserved: number;
  remaining: number;
  status: PoolSessionStatus;
};

export function buildPoolSessions(args: {
  date: string;
  now: Date;
  sessions: { id: string; name: string; startMinute: number; endMinute: number }[];
  inventory: { poolSessionId: string; capacity: number; reserved: number; isClosed: boolean }[];
  defaultCapacity: number;
  cutoffMinutes: number;
}): PoolSessionView[] {
  const { date, now, sessions, inventory, defaultCapacity, cutoffMinutes } = args;
  return [...sessions]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((s) => {
      const inv = inventory.find((i) => i.poolSessionId === s.id);
      const capacity = inv?.capacity ?? defaultCapacity;
      const reserved = inv?.reserved ?? 0;
      const remaining = Math.max(0, capacity - reserved);
      const lastBookable = manilaToUtc(date, s.endMinute - cutoffMinutes);

      let status: PoolSessionStatus = "available";
      if (now >= lastBookable) status = "past";
      else if (inv?.isClosed) status = "closed";
      else if (remaining === 0) status = "full";

      return { ...s, capacity, reserved, remaining, status };
    });
}
