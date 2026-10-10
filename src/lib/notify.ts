// Notifications: record first (outbox), then send. Never throws — a failed email must not
// break a booking or a payment. Failed sends are retried by the scheduled job.
import type { Notification, NotificationChannel } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { renderEmail, renderSms, type MessageEvent, type MessageView } from "./templates";
import { sendEmail, sendSms, smsConfigured, NotConfigured } from "./senders";
import { qrPng } from "./qr";
import { formatPeso } from "./pricing";
import { formatMinute, manilaToUtc, utcToManila } from "./time";

export type NotifyEvent =
  | "PROOF_RECEIVED" | "BOOKING_CONFIRMED" | "PAYMENT_REJECTED" | "NEEDS_ATTENTION"
  | "REMINDER" | "CANCELLED" | "RESCHEDULED";

type Extra = { reason?: string; paymentId?: string; amountCentavos?: number };

const CUSTOMER_EMAIL: NotifyEvent[] = ["PROOF_RECEIVED", "BOOKING_CONFIRMED", "PAYMENT_REJECTED", "REMINDER", "CANCELLED", "RESCHEDULED"];
const STAFF_EVENT: Partial<Record<NotifyEvent, MessageEvent>> = {
  PROOF_RECEIVED: "STAFF_PROOF_RECEIVED",
  NEEDS_ATTENTION: "STAFF_NEEDS_ATTENTION",
};

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Which message this is a duplicate of. Same key = never sent twice. */
function dedupeKey(event: NotifyEvent, channel: string, recipient: string, b: { id: string; startAt: Date }, extra: Extra) {
  const part =
    event === "REMINDER" || event === "RESCHEDULED" ? b.startAt.toISOString()
    : event === "PAYMENT_REJECTED" ? extra.paymentId ?? ""
    : event === "NEEDS_ATTENTION" ? String(Date.now())
    : "";
  return `${event}:${channel}:${recipient}:${b.id}:${part}`;
}

export async function notify(event: NotifyEvent, bookingId: string, extra: Extra = {}) {
  try {
    const [b, settings] = await Promise.all([
      prisma.booking.findUnique({ where: { id: bookingId } }),
      getSettings(),
    ]);
    if (!b || b.kind !== "BOOKING") return;

    const rows: { channel: NotificationChannel; recipient: string; event: string }[] = [];
    if (CUSTOMER_EMAIL.includes(event) && b.email) rows.push({ channel: "EMAIL", recipient: b.email, event });
    if (b.mobile && smsConfigured() && settings.notifications.smsEvents.includes(event))
      rows.push({ channel: "SMS", recipient: b.mobile, event });
    const staffEvent = STAFF_EVENT[event];
    if (staffEvent) for (const to of settings.notifications.staffEmails) rows.push({ channel: "EMAIL", recipient: to, event: staffEvent });
    if (rows.length === 0) return;

    const created = await Promise.all(
      rows.map((r) =>
        prisma.notification
          .create({
            data: {
              bookingId: b.id, event: r.event, channel: r.channel, recipient: r.recipient,
              dedupeKey: dedupeKey(event, r.channel + r.event, r.recipient, b, extra), payload: extra,
            },
          })
          .catch(() => null), // duplicate = already sent or queued
      ),
    );
    await Promise.allSettled(created.filter((n): n is Notification => !!n).map(deliver));
  } catch (e) {
    console.error(`[notify] ${event} for ${bookingId} failed to queue`, e);
  }
}

/** Is this message still true? (e.g. don't send "confirmed" if it was cancelled before a retry) */
function stillRelevant(event: string, status: string, startAt: Date) {
  switch (event) {
    case "BOOKING_CONFIRMED": return status === "CONFIRMED" || status === "CHECKED_IN";
    case "RESCHEDULED": return status === "CONFIRMED" || status === "PENDING_VERIFICATION";
    case "REMINDER": return status === "CONFIRMED" && startAt > new Date();
    case "PROOF_RECEIVED": case "STAFF_PROOF_RECEIVED": return status === "PENDING_VERIFICATION";
    default: return true;
  }
}

export async function deliver(n: Notification) {
  const b = n.bookingId
    ? await prisma.booking.findUnique({ where: { id: n.bookingId }, include: { amenity: true, payments: true } })
    : null;
  if (!b) return prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", lastError: "Booking not found" } });
  if (!stillRelevant(n.event, b.status, b.startAt))
    return prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", lastError: `No longer relevant (booking is ${b.status})` } });

  const settings = await getSettings();
  const s = utcToManila(b.startAt);
  const e = utcToManila(b.endAt);
  const paid = b.payments.filter((p) => p.status === "PAID").reduce((t, p) => t + p.amountCentavos, 0);
  const balance = Math.max(0, b.totalCentavos - paid);
  const extra = (n.payload ?? {}) as Extra;
  const pendingProof = b.payments.find((p) => p.status === "PENDING" && p.type === "RESERVATION_FEE");
  const isPool = b.amenity.type === "POOL";
  const dateAt = manilaToUtc(s.date, 720);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...o }).format(dateAt);
  const withQr = n.channel === "EMAIL" && ["BOOKING_CONFIRMED", "RESCHEDULED", "REMINDER"].includes(n.event);

  const view: MessageView = {
    facilityName: settings.facility.name,
    address: settings.facility.address,
    contact: settings.contact_info,
    ref: b.referenceCode,
    amenityName: isPool ? "Swimming pool" : b.amenity.name,
    dateLabel: fmt({ weekday: "long", month: "long", day: "numeric" }),
    shortDate: fmt({ month: "short", day: "numeric" }),
    timeLabel: `${formatMinute(s.minuteOfDay)} to ${formatMinute(e.minuteOfDay === 0 ? 1440 : e.minuteOfDay)}`,
    startLabel: formatMinute(s.minuteOfDay),
    guestsLabel: isPool
      ? `${b.adults} adult${b.adults === 1 ? "" : "s"}${b.kids ? `, ${b.kids} kid${b.kids === 1 ? "" : "s"}` : ""}`
      : `${b.adults} player${b.adults === 1 ? "" : "s"}`,
    customerName: b.customerName ?? "there",
    totalLabel: formatPeso(b.totalCentavos),
    paidLabel: formatPeso(paid),
    balanceLabel: formatPeso(balance),
    balanceCentavos: balance,
    bookingUrl: `${appUrl()}/booking/${b.referenceCode}?t=${b.accessToken}`,
    adminUrl: n.event === "STAFF_PROOF_RECEIVED" ? `${appUrl()}/admin/payments` : `${appUrl()}/admin/bookings/${b.id}`,
    policyText: settings.policy_text,
    reason: extra.reason ?? b.attentionReason ?? undefined,
    amountLabel: pendingProof ? formatPeso(pendingProof.amountCentavos) : undefined,
    hasQr: withQr,
  };

  try {
    if (n.channel === "EMAIL") {
      await sendEmail(n.recipient, renderEmail(n.event as MessageEvent, view), withQr ? await qrPng(b.referenceCode) : undefined);
    } else {
      const text = renderSms(n.event as MessageEvent, view);
      if (!text) return prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", lastError: "No SMS for this event" } });
      await sendSms(n.recipient, text);
    }
    return prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
  } catch (err) {
    const notConfigured = err instanceof NotConfigured;
    if (notConfigured) console.log(`[notify] not sent (${(err as Error).message}) ${n.channel} ${n.event} to ${n.recipient}`);
    else console.error(`[notify] ${n.channel} ${n.event} to ${n.recipient} failed`, err);
    return prisma.notification.update({
      where: { id: n.id },
      data: { status: notConfigured ? "SKIPPED" : "FAILED", attempts: { increment: 1 }, lastError: String((err as Error).message).slice(0, 500) },
    });
  }
}
