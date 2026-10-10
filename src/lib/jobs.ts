// Scheduled housekeeping, run every ~10 minutes by /api/cron/run.
import { timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { expireStaleHolds } from "./availability";
import { deliver, notify } from "./notify";
import { deleteProof } from "./storage";

export const PROOF_RETENTION_DAYS = 90; // matches the privacy notice
const MAX_ATTEMPTS = 5;

export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function runScheduledJobs(now = new Date()) {
  const settings = await getSettings();
  const summary = { holdsExpired: 0, completed: 0, reminders: 0, retried: 0, proofsDeleted: 0 };

  // 1. Release unpaid holds
  const [{ expire_stale_holds }] = await prisma.$queryRaw<{ expire_stale_holds: number }[]>`SELECT expire_stale_holds()`;
  summary.holdsExpired = expire_stale_holds;

  // 2. Checked-in bookings that ended 30+ minutes ago are completed
  summary.completed = (
    await prisma.booking.updateMany({
      where: { status: "CHECKED_IN", endAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
      data: { status: "COMPLETED" },
    })
  ).count;

  // 3. Reminders for confirmed bookings starting within the reminder window.
  //    Bookings made inside the window are skipped (they just got their confirmation).
  const windowMs = settings.reminder_hours_before * 3_600_000;
  const upcoming = await prisma.booking.findMany({
    where: {
      kind: "BOOKING", status: "CONFIRMED",
      startAt: { gt: now, lte: new Date(now.getTime() + windowMs) },
      notifications: { none: { event: "REMINDER", status: { in: ["SENT", "PENDING"] } } },
    },
    select: { id: true, startAt: true, createdAt: true },
    take: 100,
  });
  for (const b of upcoming) {
    if (b.createdAt.getTime() > b.startAt.getTime() - windowMs) continue;
    await notify("REMINDER", b.id);
    summary.reminders++;
  }

  // 4. Retry failed sends, and pick up any that got stuck mid-send
  const retry = await prisma.notification.findMany({
    where: {
      createdAt: { gt: new Date(now.getTime() - 2 * 86_400_000) },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ status: "FAILED" }, { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } }],
    },
    take: 50,
  });
  for (const n of retry) await deliver(n);
  summary.retried = retry.length;

  // 5. Privacy: delete GCash screenshots 90 days after the booking date
  const old = await prisma.payment.findMany({
    where: { proofImagePath: { not: null }, booking: { endAt: { lt: new Date(now.getTime() - PROOF_RETENTION_DAYS * 86_400_000) } } },
    select: { id: true, proofImagePath: true },
    take: 100,
  });
  for (const p of old) {
    await deleteProof(p.proofImagePath!);
    await prisma.payment.update({ where: { id: p.id }, data: { proofImagePath: null } });
  }
  summary.proofsDeleted = old.length;

  return summary;
}
