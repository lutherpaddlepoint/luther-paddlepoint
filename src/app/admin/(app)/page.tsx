import Link from "next/link";
import { attentionCounts, collectedOn, dayView } from "@/lib/admin-data";
import { requireUser } from "@/lib/auth";
import { formatPeso } from "@/lib/pricing";
import { manilaToUtc, todayInManila } from "@/lib/time";
import DaySchedule from "@/components/admin/DaySchedule";
import ActionForm, { inputCls } from "@/components/admin/ActionForm";
import { findBookingAction } from "@/app/admin/actions";

const peso = (c: number) => formatPeso(c).replace(".00", "");

export default async function TodayPage({ searchParams }: { searchParams: { denied?: string } }) {
  await requireUser();
  const today = todayInManila();
  const [day, money, counts] = await Promise.all([dayView(today), collectedOn(today), attentionCounts()]);
  const label = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric" }).format(manilaToUtc(today, 720));

  return (
    <div>
      {searchParams.denied && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">That page is for the owner only.</p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted">Today</p>
          <h1 className="font-display text-3xl font-extrabold">{label}</h1>
        </div>
        <ActionForm action={findBookingAction} submitLabel="Open" tone="plain" className="flex items-end gap-2">
          <label className="text-sm font-bold">
            Find booking
            <input name="code" placeholder="LPP-7K3QX" className={`${inputCls} w-40 uppercase`} autoComplete="off" />
          </label>
        </ActionForm>
      </div>

      {(counts.pendingPayments > 0 || counts.attention > 0) && (
        <Link href="/admin/payments" className="mt-5 block rounded-2xl bg-dusk px-5 py-4 text-white">
          <span className="font-display text-lg font-semibold">
            {counts.pendingPayments > 0 && `${counts.pendingPayments} GCash payment${counts.pendingPayments === 1 ? "" : "s"} to check`}
            {counts.pendingPayments > 0 && counts.attention > 0 && ", "}
            {counts.attention > 0 && `${counts.attention} booking${counts.attention === 1 ? "" : "s"} need${counts.attention === 1 ? "s" : ""} attention`}
          </span>
          <span className="block text-sm text-white/80">Open payments</span>
        </Link>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bookings today" value={String(day.totals.bookings)} />
        <Stat label="Court booked" value={`${Math.round(day.totals.courtOccupancy * 100)}%`} sub={`${day.totals.courtBookedHours} hours`} />
        <Stat
          label="Pool guests"
          value={day.totals.poolGuests.map((p) => `${p.reserved}/${p.capacity}`).join(", ") || "0"}
          sub={day.totals.poolGuests.map((p) => p.name.replace(" session", "")).join(", ")}
        />
        <Stat label="Collected today" value={peso(money.total)} sub={`Cash ${peso(money.cash)}, GCash ${peso(money.gcash)}`} />
      </dl>
      {day.totals.balanceDueCentavos > 0 && (
        <p className="mt-3 text-sm text-muted">Still to collect on-site today: <strong className="text-ink">{peso(day.totals.balanceDueCentavos)}</strong></p>
      )}

      <div className="mt-8">
        <DaySchedule day={day} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-2xl font-semibold">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
