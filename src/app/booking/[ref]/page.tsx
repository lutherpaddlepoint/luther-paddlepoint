import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { expireStaleHolds } from "@/lib/availability";
import { formatPeso } from "@/lib/pricing";
import { formatMinute, utcToManila, manilaToUtc } from "@/lib/time";
import { formatPhMobile } from "@/lib/phone";
import HoldCountdown from "@/components/HoldCountdown";
import PaymentBox from "@/components/PaymentBox";
import AutoRefresh from "@/components/AutoRefresh";
import { getSettings } from "@/lib/settings";
import { tokenMatches, SLOT_TAKEN_NOTE } from "@/lib/payments";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

const STATUS: Record<string, { title: string; body: string; tone: string }> = {
  PENDING_VERIFICATION: { title: "Payment received, checking it now", body: "Our staff is verifying your GCash payment. You’ll get an email once your booking is confirmed.", tone: "bg-dusk text-white" },
  CONFIRMED: { title: "You’re booked", body: "Show your reference code at the counter. Pay the balance on-site.", tone: "bg-court text-white" },
  CHECKED_IN: { title: "Checked in", body: "Enjoy your time!", tone: "bg-court text-white" },
  COMPLETED: { title: "Completed", body: "Thanks for visiting. See you again!", tone: "bg-white text-ink border border-line" },
  EXPIRED: { title: "This hold has expired", body: "The reservation fee wasn’t paid in time, so the slot was released.", tone: "bg-white text-ink border border-line" },
  CANCELLED: { title: "Cancelled", body: "This booking was cancelled.", tone: "bg-white text-ink border border-line" },
  REJECTED: { title: "Payment not accepted", body: "We couldn’t verify your GCash payment, so the slot was released. If you did pay, please contact us with your reference code.", tone: "bg-white text-ink border border-line" },
  NO_SHOW: { title: "Marked as no-show", body: "This booking wasn’t used.", tone: "bg-white text-ink border border-line" },
};

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { t?: string; paid?: string };
}) {
  const token = searchParams.t ?? "";
  if (!token || !/^LPP-[A-Z0-9]{5}$/.test(params.ref)) notFound();

  await expireStaleHolds();
  const b = await prisma.booking.findUnique({
    where: { referenceCode: params.ref },
    include: { amenity: true, lineItems: true, payments: { orderBy: { createdAt: "desc" } } },
  });
  // Same "not found" whether the code or the secret is wrong, so codes can't be probed.
  if (!b || !tokenMatches(b, token)) notFound();

  const start = utcToManila(b.startAt);
  const end = utcToManila(b.endAt);
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(manilaToUtc(start.date, 12 * 60));
  const isPool = b.amenity.type === "POOL";
  const status = STATUS[b.status];
  const settings = await getSettings();
  const livePayment = b.payments.find((p) => p.type === "RESERVATION_FEE" && p.status !== "REJECTED");
  const slotTaken = b.status === "EXPIRED" && b.attentionReason === SLOT_TAKEN_NOTE;
  const waitingForPaymongo = b.status === "HOLD" && searchParams.paid === "1";
  const canPay =
    b.status === "HOLD" ||
    (b.status === "EXPIRED" && !livePayment && settings.payment_mode === "GCASH_MANUAL");
  const fee = formatPeso(b.reservationFeeCentavos);
  const showQr = b.status === "CONFIRMED" || b.status === "CHECKED_IN";
  const qr = showQr ? await qrSvg(b.referenceCode) : null;

  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <Link href="/" className="font-display text-lg font-semibold text-court">Luther PaddlePoint &amp; Pool</Link>

      {waitingForPaymongo ? (
        <section className="mt-6 rounded-2xl bg-dusk p-6 text-white">
          <AutoRefresh />
          <h1 className="font-display text-2xl font-semibold">Confirming your GCash payment…</h1>
          <p className="mt-2 opacity-90">This usually takes a few seconds. This page updates by itself.</p>
        </section>
      ) : slotTaken ? (
        <section className="mt-6 rounded-2xl bg-dusk p-6 text-white">
          <h1 className="font-display text-2xl font-semibold">We received your payment proof</h1>
          <p className="mt-2 opacity-90">
            Your hold ran out before it arrived, and someone else booked that time in the meantime. We’ll contact
            you at {b.mobile ? formatPhMobile(b.mobile) : "your mobile number"} to move your booking to another
            time. Keep your reference code {b.referenceCode}.
          </p>
        </section>
      ) : b.status === "HOLD" && b.holdExpiresAt ? (
        <section className="mt-6 rounded-2xl bg-ball p-6 text-ink">
          <p className="font-bold">Your slot is held for</p>
          <HoldCountdown expiresAt={b.holdExpiresAt.toISOString()} />
          <p className="mt-2">
            Pay the <strong>{fee}</strong> reservation fee before the timer runs out to keep your booking.
          </p>
        </section>
      ) : status ? (
        <section className={`mt-6 rounded-2xl p-6 ${status.tone}`}>
          <h1 className="font-display text-2xl font-semibold">{status.title}</h1>
          <p className="mt-2 opacity-90">{status.body}</p>
          {b.status === "EXPIRED" && (
            <Link href="/" className="mt-4 inline-block rounded-xl bg-court px-5 py-3 font-bold text-white">Book again</Link>
          )}
        </section>
      ) : null}

      {canPay && !waitingForPaymongo && (
        <PaymentBox
          referenceCode={b.referenceCode}
          token={token}
          amountLabel={fee}
          amountPlain={(b.reservationFeeCentavos / 100).toFixed(2)}
          mode={settings.payment_mode}
          gcash={settings.gcash_account}
          afterExpiry={b.status === "EXPIRED"}
        />
      )}

      {b.status === "PENDING_VERIFICATION" && livePayment?.gcashReference && (
        <p className="mt-4 text-sm text-muted">
          GCash Ref. No. submitted: ending in {livePayment.gcashReference.slice(-4)}
        </p>
      )}

      {qr && (
        <section className="mt-4 rounded-2xl border border-line bg-white p-5 text-center">
          {/* QR contains only the reference code */}
          <div className="mx-auto w-48" aria-label={`QR code for ${b.referenceCode}`} role="img" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-2 text-sm text-muted">Show this at the counter. It was also sent to your email.</p>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <p className="text-sm text-muted">Reference code</p>
        <p className="font-display text-3xl font-extrabold tracking-wide">{b.referenceCode}</p>

        <h2 className="mt-5 font-display text-xl font-semibold">{isPool ? "Swimming pool" : b.amenity.name}</h2>
        <p>{dateLabel}</p>
        <p className="text-muted">
          {formatMinute(start.minuteOfDay)} to {formatMinute(end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}
        </p>
        <p className="text-muted">
          {isPool
            ? `${b.adults} adult${b.adults === 1 ? "" : "s"}${b.kids ? `, ${b.kids} kid${b.kids === 1 ? "" : "s"}` : ""}`
            : `${b.adults} player${b.adults === 1 ? "" : "s"}`}
        </p>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {b.lineItems.map((li) => (
              <tr key={li.id}>
                <td className="py-1 pr-2">{li.description}{li.quantity > 1 ? ` × ${li.quantity}` : ""}</td>
                <td className="py-1 text-right">{formatPeso(li.amountCentavos)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-bold">
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right">{formatPeso(b.totalCentavos)}</td>
            </tr>
            <tr>
              <td className="py-1">Reservation fee (non-refundable)</td>
              <td className="py-1 text-right">{formatPeso(b.reservationFeeCentavos)}</td>
            </tr>
            <tr>
              <td>Balance, pay on-site</td>
              <td className="text-right">{formatPeso(b.balanceCentavos)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-5 text-sm text-muted">
          Booked by {b.customerName}, {b.mobile ? formatPhMobile(b.mobile) : ""}
        </p>
      </section>

      <p className="mt-6 text-sm text-muted">
        Keep this page’s link private. It’s your proof of booking and lets you check its status.
      </p>
    </main>
  );
}
