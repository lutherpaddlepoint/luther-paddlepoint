import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pendingManualPayments } from "@/lib/payments";
import { signedProofUrl } from "@/lib/storage";
import { formatPeso } from "@/lib/pricing";
import { formatMinute, utcToManila } from "@/lib/time";
import { formatPhMobile } from "@/lib/phone";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import StatusBadge from "@/components/admin/StatusBadge";
import { approvePaymentAction, rejectPaymentAction } from "@/app/admin/actions";

const when = (d: Date) => {
  const m = utcToManila(d);
  return `${m.date} ${formatMinute(m.minuteOfDay)}`;
};

export default async function PaymentsPage() {
  await requireUser();
  const [pending, attention] = await Promise.all([
    pendingManualPayments(),
    prisma.booking.findMany({ where: { attentionReason: { not: null } }, orderBy: { updatedAt: "asc" }, include: { amenity: true } }),
  ]);
  const withLinks = await Promise.all(
    pending.map(async (p) => ({ ...p, proofUrl: p.proofImagePath ? await signedProofUrl(p.proofImagePath, 900).catch(() => null) : null })),
  );

  return (
    <div className="grid gap-10">
      <section>
        <h1 className="font-display text-3xl font-extrabold">GCash payments to check</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Open your GCash app and find each payment by its Ref. No. Approve only if the amount arrived. Screenshots can be edited,
          so never approve from the screenshot alone.
        </p>

        {withLinks.length === 0 && <p className="mt-6 rounded-2xl border border-line bg-white px-5 py-6 text-muted">Nothing to check right now.</p>}

        <div className="mt-6 grid gap-5">
          {withLinks.map((p) => {
            const b = p.booking;
            const s = utcToManila(b.startAt);
            const e = utcToManila(b.endAt);
            return (
              <article key={p.id} className="grid gap-5 rounded-2xl border border-line bg-white p-5 md:grid-cols-[220px_1fr]">
                <div>
                  {p.proofUrl ? (
                    <a href={p.proofUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.proofUrl} alt={`GCash receipt for ${b.referenceCode}`} className="max-h-96 w-full rounded-xl border border-line object-contain" />
                      <span className="mt-1 block text-center text-sm text-court underline">Open full size</span>
                    </a>
                  ) : (
                    <p className="text-sm text-muted">No screenshot.</p>
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/bookings/${b.id}`} className="font-display text-2xl font-semibold underline-offset-2 hover:underline">{b.referenceCode}</Link>
                    <StatusBadge status={b.status} />
                    {b.attentionReason && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Slot was taken</span>}
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">Amount due</dt>
                    <dd className="font-display text-xl font-semibold">{formatPeso(p.amountCentavos)}</dd>
                    <dt className="text-muted">GCash Ref. No.</dt>
                    <dd className="select-all font-bold tracking-wider">{p.gcashReference}</dd>
                    <dt className="text-muted">Customer</dt>
                    <dd>{b.customerName}, {b.mobile ? formatPhMobile(b.mobile) : "no mobile"}</dd>
                    <dt className="text-muted">Booking</dt>
                    <dd>{b.amenity.name}, {s.date}, {formatMinute(s.minuteOfDay)}–{formatMinute(e.minuteOfDay)}{b.amenity.type === "POOL" ? `, ${b.adults} adults, ${b.kids} kids` : ""}</dd>
                    <dt className="text-muted">Sent</dt>
                    <dd>{when(p.createdAt)}</dd>
                  </dl>

                  <div className="mt-4 flex flex-wrap items-start gap-6">
                    <ActionForm
                      action={approvePaymentAction}
                      submitLabel={`Approve ${formatPeso(p.amountCentavos)}`}
                      confirm={`Approve ${formatPeso(p.amountCentavos)} for ${b.referenceCode}, Ref. No. ${p.gcashReference}? Only approve if you can see it in your GCash app.`}
                      pendingLabel="Approving…"
                    >
                      <input type="hidden" name="paymentId" value={p.id} />
                    </ActionForm>
                    <ActionForm action={rejectPaymentAction} submitLabel="Reject" tone="danger" pendingLabel="Rejecting…"
                      confirm="Reject this payment? The customer's slot will be released." className="min-w-56 flex-1">
                      <input type="hidden" name="paymentId" value={p.id} />
                      <label className={labelCls}>
                        Reason
                        <select name="reason" className={inputCls} defaultValue="Payment not received in GCash">
                          <option>Payment not received in GCash</option>
                          <option>Wrong amount</option>
                          <option>Ref. No. doesn&apos;t match</option>
                          <option>Screenshot looks edited</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label className={`${labelCls} mt-2`}>
                        If other, explain
                        <input name="otherReason" className={inputCls} />
                      </label>
                    </ActionForm>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-extrabold">Needs attention</h2>
        <p className="mt-1 text-muted">Bookings where something unusual happened. Open each one, sort it out with the customer, then mark it resolved.</p>
        {attention.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-line bg-white px-5 py-6 text-muted">Nothing needs attention.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {attention.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/bookings/${b.id}`} className="block rounded-2xl border border-red-200 bg-white px-5 py-4 hover:bg-paper">
                  <span className="font-bold">{b.referenceCode}</span> <span className="text-muted">{b.customerName}, {b.mobile ? formatPhMobile(b.mobile) : ""}</span>
                  <span className="mt-1 block text-sm text-red-800">{b.attentionReason}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
