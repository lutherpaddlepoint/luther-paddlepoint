import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { bookingDetail, bookingHistory } from "@/lib/admin-data";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { signedProofUrl } from "@/lib/storage";
import { formatPeso } from "@/lib/pricing";
import { formatMinute, todayInManila, utcToManila } from "@/lib/time";
import { formatPhMobile } from "@/lib/phone";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import StatusBadge from "@/components/admin/StatusBadge";
import HourSelect from "@/components/admin/HourSelect";
import CourtTimerControls from "@/components/admin/CourtTimerControls";
import { getCourtTimer } from "@/lib/court-timer";
import { listCourts } from "@/lib/courts";
import {
  addNoteAction, cancelAction, checkInAction, noShowAction, recordBalanceAction,
  removeBlockAction, rescheduleAction, resolveAttentionAction,
} from "@/app/admin/actions";

const METHOD: Record<string, string> = { CASH: "Cash", GCASH_MANUAL: "GCash", GCASH_PAYMONGO: "GCash (PayMongo)" };
const TYPE: Record<string, string> = { RESERVATION_FEE: "Reservation fee", BALANCE: "Balance" };
const stamp = (d: Date) => {
  const m = utcToManila(d);
  return `${m.date} ${formatMinute(m.minuteOfDay)}`;
};

export default async function BookingPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const b = await bookingDetail(params.id);
  if (!b) notFound();
  const [history, settings] = await Promise.all([bookingHistory(b.id), getSettings()]);
  const isOwner = user.role === "OWNER";
  const isPool = b.amenity.type === "POOL";
  const s = utcToManila(b.startAt);
  const e = utcToManila(b.endAt);
  const paid = b.payments.filter((p) => p.status === "PAID").reduce((t, p) => t + p.amountCentavos, 0);
  const due = Math.max(0, b.totalCentavos - paid);
  const isToday = s.date === todayInManila();
  const started = b.startAt <= new Date();
  const sessions = isPool ? await prisma.poolSession.findMany({ where: { amenityId: b.amenityId, isActive: true }, orderBy: { startMinute: "asc" } }) : [];
  const proofLinks = await Promise.all(b.payments.map((p) => (p.proofImagePath ? signedProofUrl(p.proofImagePath, 900).catch(() => null) : null)));
  const { openMinute, closeMinute } = settings.operating_hours;
  const canTime = !isPool && isToday && (b.status === "CONFIRMED" || b.status === "CHECKED_IN") && b.endAt > new Date();
  const timer = canTime ? await getCourtTimer(b.amenityId) : null;
  const courtNo = canTime ? (await listCourts()).find((c) => c.id === b.amenityId)?.number : undefined;

  if (b.kind === "BLOCK") {
    return (
      <div className="max-w-xl">
        <Link href={`/admin/calendar?date=${s.date}`} className="text-sm font-bold text-court underline">Back to calendar</Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold">Court blocked</h1>
        <p className="mt-2 text-lg">{s.date}, {formatMinute(s.minuteOfDay)}–{formatMinute(e.minuteOfDay)}</p>
        <p className="text-muted">{b.notes}</p>
        <StatusBadge status={b.status} kind="BLOCK" />
        {isOwner && b.status === "CONFIRMED" && (
          <ActionForm action={removeBlockAction} submitLabel="Remove block" tone="plain" confirm="Open this time for bookings again?" className="mt-6">
            <input type="hidden" name="bookingId" value={b.id} />
          </ActionForm>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="grid content-start gap-6">
        <div>
          <Link href={`/admin/calendar?date=${s.date}`} className="text-sm font-bold text-court underline">Back to calendar</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold">{b.referenceCode}</h1>
            <StatusBadge status={b.status} />
            {b.source === "WALK_IN" && <span className="text-sm text-muted">Walk-in{b.createdBy ? ` by ${b.createdBy.name}` : ""}</span>}
          </div>
        </div>

        {b.attentionReason && (
          <section className="rounded-2xl border-2 border-red-700 bg-red-50 p-5">
            <h2 className="font-display text-lg font-semibold text-red-800">Needs attention</h2>
            <p className="mt-1 text-red-900">{b.attentionReason}</p>
            <ActionForm action={resolveAttentionAction} submitLabel="Mark resolved" className="mt-3">
              <input type="hidden" name="bookingId" value={b.id} />
              <label className={labelCls}>
                What was done?
                <input name="note" className={inputCls} placeholder="e.g. Moved to Oct 14, 7–8 PM; customer agreed" />
              </label>
            </ActionForm>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-xl font-semibold">{b.amenity.name}</h2>
          <p className="text-lg">{s.date}, {formatMinute(s.minuteOfDay)}–{formatMinute(e.minuteOfDay === 0 ? 1440 : e.minuteOfDay)}</p>
          <p className="text-muted">{isPool ? `${b.adults} adult(s), ${b.kids} kid(s)` : `${b.adults} player(s)`}{b.rescheduleCount ? `, rescheduled ${b.rescheduleCount}×` : ""}</p>
          <p className="mt-3">
            <span className="font-bold">{b.customerName}</span>
            {b.mobile && <> <a href={`tel:${b.mobile}`} className="text-court underline">{formatPhMobile(b.mobile)}</a></>}
            {b.email && <span className="block text-sm text-muted">{b.email}</span>}
          </p>

          <table className="mt-4 w-full text-sm">
            <tbody>
              {b.lineItems.map((li) => (
                <tr key={li.id}><td className="py-0.5">{li.description}{li.quantity > 1 ? ` × ${li.quantity}` : ""}</td><td className="text-right">{formatPeso(li.amountCentavos)}</td></tr>
              ))}
              <tr className="border-t border-line font-bold"><td className="pt-2">Total</td><td className="pt-2 text-right">{formatPeso(b.totalCentavos)}</td></tr>
              <tr><td>Paid</td><td className="text-right">{formatPeso(paid)}</td></tr>
              <tr className="font-display text-lg font-semibold"><td>Balance due</td><td className="text-right">{formatPeso(due)}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-xl font-semibold">Payments</h2>
          {b.payments.length === 0 ? <p className="mt-2 text-muted">No payments yet.</p> : (
            <ul className="mt-2 grid gap-2 text-sm">
              {b.payments.map((p, i) => (
                <li key={p.id} className="rounded-lg border border-line px-3 py-2">
                  <span className="font-bold">{TYPE[p.type]} {formatPeso(p.amountCentavos)}</span>, {METHOD[p.method]}{" "}
                  <span className={p.status === "PAID" ? "text-court" : p.status === "REJECTED" ? "text-red-700" : "text-dusk"}>({p.status.toLowerCase()})</span>
                  {p.gcashReference && <span className="block text-muted">Ref. No. {p.gcashReference}</span>}
                  {p.verifiedBy && <span className="block text-muted">By {p.verifiedBy.name}{p.paidAt ? `, ${stamp(p.paidAt)}` : ""}</span>}
                  {p.rejectionReason && <span className="block text-red-700">{p.rejectionReason}</span>}
                  {proofLinks[i] && <a href={proofLinks[i]!} target="_blank" rel="noreferrer" className="text-court underline">View screenshot</a>}
                  {p.status === "PENDING" && p.method === "GCASH_MANUAL" && <Link href="/admin/payments" className="ml-2 text-court underline">Check it</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-xl font-semibold">Notes and history</h2>
          {b.notes && <p className="mt-2 whitespace-pre-line rounded-lg bg-paper px-3 py-2 text-sm">{b.notes}</p>}
          <ActionForm action={addNoteAction} submitLabel="Add note" tone="plain" resetOnSuccess>
            <input type="hidden" name="bookingId" value={b.id} />
            <input name="note" className={`${inputCls} mt-3`} placeholder="e.g. Customer called, will arrive 15 min late" />
          </ActionForm>
          {b.notifications.length > 0 && (
            <ul className="mt-4 grid gap-1 text-xs">
              {b.notifications.map((n) => (
                <li key={n.id} className={n.status === "FAILED" ? "text-red-700" : "text-muted"}>
                  {n.channel === "SMS" ? "SMS" : "Email"} “{n.event.replace(/_/g, " ").toLowerCase()}” to {n.recipient}:{" "}
                  {n.status === "SENT" ? `sent ${n.sentAt ? stamp(n.sentAt) : ""}` : n.status.toLowerCase()}
                  {n.status !== "SENT" && n.lastError ? ` (${n.lastError})` : ""}
                </li>
              ))}
            </ul>
          )}
          <ol className="mt-4 grid gap-1 text-xs text-muted">
            {history.map((h) => (
              <li key={h.id}>{stamp(h.createdAt)}: {h.action.replace(/_/g, " ").toLowerCase()}{h.user ? ` by ${h.user.name}` : ""}</li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="grid content-start gap-5">
        {canTime && <CourtTimerControls timer={timer} bookingId={b.id} courtId={b.amenityId} courtName={b.amenity.name} courtNumber={courtNo} />}
        {b.status === "CONFIRMED" && (
          <section className="rounded-2xl border-2 border-court bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Check in</h2>
            {!isToday ? (
              <p className="mt-1 text-sm text-muted">Check-in opens on the day of the booking ({s.date}).</p>
            ) : (
              <ActionForm action={checkInAction} submitLabel="Check in" full>
                <input type="hidden" name="bookingId" value={b.id} />
                {due > 0 ? (
                  <>
                    <p className="mt-1">Collect the balance of <strong>{formatPeso(due)}</strong>:</p>
                    <label className={`${labelCls} mt-2`}>
                      Paid by
                      <select name="collect" className={inputCls} defaultValue="CASH">
                        <option value="CASH">Cash</option>
                        <option value="GCASH_MANUAL">GCash</option>
                        <option value="LATER">Not yet (collect later)</option>
                      </select>
                    </label>
                    <label className={`${labelCls} mt-2`}>
                      GCash Ref. No. (if GCash)
                      <input name="gcashReference" inputMode="numeric" className={inputCls} />
                    </label>
                  </>
                ) : (
                  <><p className="mt-1 text-sm text-muted">Fully paid.</p><input type="hidden" name="collect" value="LATER" /></>
                )}
              </ActionForm>
            )}
          </section>
        )}

        {b.status === "CHECKED_IN" && due > 0 && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Collect balance</h2>
            <ActionForm action={recordBalanceAction} submitLabel={`Record ${formatPeso(due)} paid`} full>
              <input type="hidden" name="bookingId" value={b.id} />
              <label className={`${labelCls} mt-2`}>
                Paid by
                <select name="method" className={inputCls}><option value="CASH">Cash</option><option value="GCASH_MANUAL">GCash</option></select>
              </label>
              <label className={`${labelCls} mt-2`}>
                GCash Ref. No. (if GCash)
                <input name="gcashReference" inputMode="numeric" className={inputCls} />
              </label>
            </ActionForm>
          </section>
        )}

        {b.status === "CONFIRMED" && started && (
          <ActionForm action={noShowAction} submitLabel="Mark as no-show" tone="plain" full
            confirm="Mark as no-show? The reservation fee is kept and pool spots are released.">
            <input type="hidden" name="bookingId" value={b.id} />
          </ActionForm>
        )}

        {isOwner && ["CONFIRMED", "PENDING_VERIFICATION"].includes(b.status) && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Reschedule</h2>
            <p className="mt-1 text-sm text-muted">
              Policy: once, at least {settings.reschedule_policy.minHoursBefore} hours before. The paid fee carries over; the balance is recalculated.
            </p>
            {b.rescheduleCount >= settings.reschedule_policy.maxTimes ? (
              <p className="mt-2 text-sm font-bold">Already rescheduled the maximum number of times.</p>
            ) : (
              <ActionForm action={rescheduleAction} submitLabel="Reschedule" confirm="Move this booking to the new time?" full>
                <input type="hidden" name="bookingId" value={b.id} />
                <label className={`${labelCls} mt-2`}>New date<input type="date" name="date" defaultValue={s.date} min={todayInManila()} className={inputCls} required /></label>
                {isPool ? (
                  <>
                    <label className={`${labelCls} mt-2`}>Session
                      <select name="sessionId" className={inputCls} defaultValue={b.poolInventory?.poolSessionId}>
                        {sessions.map((x) => <option key={x.id} value={x.id}>{x.name} ({formatMinute(x.startMinute)}–{formatMinute(x.endMinute)})</option>)}
                      </select>
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className={labelCls}>Adults<input type="number" name="adults" min={1} defaultValue={b.adults} className={inputCls} /></label>
                      <label className={labelCls}>Kids<input type="number" name="kids" min={0} defaultValue={b.kids} className={inputCls} /></label>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className={labelCls}>From<HourSelect name="start" from={openMinute} to={closeMinute - 60} defaultMinute={s.minuteOfDay} className={inputCls} /></label>
                    <label className={labelCls}>To<HourSelect name="end" from={openMinute + 60} to={closeMinute} defaultMinute={e.minuteOfDay} className={inputCls} /></label>
                  </div>
                )}
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="override" className="h-4 w-4 accent-court" /> Allow anyway (less than {settings.reschedule_policy.minHoursBefore}h notice)
                </label>
              </ActionForm>
            )}
          </section>
        )}

        {isOwner && ["HOLD", "PENDING_VERIFICATION", "CONFIRMED"].includes(b.status) && (
          <section className="rounded-2xl border border-red-200 bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Cancel booking</h2>
            <p className="mt-1 text-sm text-muted">Frees the slot. The reservation fee is not refunded.</p>
            <ActionForm action={cancelAction} submitLabel="Cancel booking" tone="danger" confirm="Cancel this booking? This can't be undone." full>
              <input type="hidden" name="bookingId" value={b.id} />
              <label className={`${labelCls} mt-2`}>Reason<input name="reason" className={inputCls} placeholder="e.g. Customer request, bad weather" /></label>
            </ActionForm>
          </section>
        )}
      </aside>
    </div>
  );
}
