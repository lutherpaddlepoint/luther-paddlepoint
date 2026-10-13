import { prisma } from "./db";
import { getSettings } from "./settings";
import { buildCourtSlots, buildPoolSessions, type CourtSlot, type PoolSessionView } from "./availability-core";
import type { RateRuleInput } from "./pricing";
import { addDays, manilaToUtc, todayInManila } from "./time";

export const ACTIVE_STATUSES = ["HOLD", "PENDING_VERIFICATION", "CONFIRMED", "CHECKED_IN"] as const;

export type Availability = {
  date: string;
  firstDate: string;
  lastDate: string;
  feePercent: number;
  lightsOnMinute: number;
  minHours: number;
  openMinute: number;
  closeMinute: number;
  /** All active courts, in name order (Court 1, Court 2, ...). */
  courts: CourtView[];
  /** The first court (kept for older screens). */
  court: CourtView | null;
  pool: { id: string; name: string; rules: RateRuleInput[]; sessions: PoolSessionView[] } | null;
};

export type CourtView = { id: string; name: string; rules: RateRuleInput[]; slots: CourtSlot[] };

export async function expireStaleHolds() {
  await prisma.$queryRaw`SELECT expire_stale_holds()`;
}

export function bookingWindow(windowDays: number, now = new Date()) {
  const firstDate = todayInManila(now);
  return { firstDate, lastDate: addDays(firstDate, windowDays - 1) };
}

const toRuleInput = (r: {
  label: string; startMinute: number; endMinute: number; priceCentavos: number;
  unit: "PER_HOUR" | "PER_PERSON"; guestType: "ADULT" | "KID" | null; daysOfWeek: number[];
}): RateRuleInput => ({
  label: r.label, startMinute: r.startMinute, endMinute: r.endMinute, priceCentavos: r.priceCentavos,
  unit: r.unit, guestType: r.guestType, daysOfWeek: r.daysOfWeek,
});

export async function getAvailability(date: string, now = new Date()): Promise<Availability> {
  await expireStaleHolds();
  const settings = await getSettings();
  const { firstDate, lastDate } = bookingWindow(settings.booking_window_days, now);
  const { openMinute, closeMinute } = settings.operating_hours;
  const dayStart = manilaToUtc(date, 0);
  const dayEnd = manilaToUtc(date, 24 * 60);

  const [courts, pool] = await Promise.all([
    prisma.amenity.findMany({
      where: { type: "COURT", isActive: true },
      orderBy: { name: "asc" },
      include: { rateRules: { where: { isActive: true } } },
    }),
    prisma.amenity.findFirst({
      where: { type: "POOL", isActive: true },
      include: {
        rateRules: { where: { isActive: true } },
        poolSessions: { where: { isActive: true } },
      },
    }),
  ]);

  // Only start/end/kind are read — customer details never leave the server here.
  const busyAll = courts.length
    ? await prisma.booking.findMany({
        where: {
          amenityId: { in: courts.map((c) => c.id) },
          exclusive: true,
          status: { in: [...ACTIVE_STATUSES] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { amenityId: true, startAt: true, endAt: true, kind: true },
      })
    : [];
  const courtViews: CourtView[] = courts.map((court) => {
    const rules = court.rateRules.map(toRuleInput);
    const busy = busyAll.filter((b) => b.amenityId === court.id).map(({ startAt, endAt, kind }) => ({ startAt, endAt, kind }));
    return {
      id: court.id,
      name: court.name,
      rules,
      slots: buildCourtSlots({ date, now, busy, rules, openMinute, closeMinute, lightsOnMinute: settings.lights_on_minute }),
    };
  });

  let poolView: Availability["pool"] = null;
  if (pool) {
    const inventory = await prisma.poolSessionInventory.findMany({
      where: { date: new Date(`${date}T00:00:00Z`), poolSessionId: { in: pool.poolSessions.map((s) => s.id) } },
      select: { poolSessionId: true, capacity: true, reserved: true, isClosed: true },
    });
    poolView = {
      id: pool.id,
      name: pool.name,
      rules: pool.rateRules.map(toRuleInput),
      sessions: buildPoolSessions({
        date, now, inventory,
        sessions: pool.poolSessions.map(({ id, name, startMinute, endMinute }) => ({ id, name, startMinute, endMinute })),
        defaultCapacity: pool.capacity ?? 30,
        cutoffMinutes: settings.pool_booking_cutoff_minutes,
      }),
    };
  }

  return {
    date, firstDate, lastDate,
    feePercent: settings.reservation_fee_percent,
    lightsOnMinute: settings.lights_on_minute,
    minHours: settings.court_min_hours,
    openMinute, closeMinute,
    courts: courtViews,
    court: courtViews[0] ?? null,
    pool: poolView,
  };
}
