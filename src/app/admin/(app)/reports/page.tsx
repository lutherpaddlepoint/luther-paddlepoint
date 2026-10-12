import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { reportData } from "@/lib/admin-data";
import { openPlayTotals } from "@/lib/open-play";
import { formatPeso } from "@/lib/pricing";
import { addDays, dayOfWeek, formatMinute, manilaToUtc, todayInManila } from "@/lib/time";

const peso = (c: number) => formatPeso(c).replace(".00", "");
const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...o }).format(manilaToUtc(d, 720));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function rangeFor(key: string, today: string): [string, string] {
  const monthStart = `${today.slice(0, 8)}01`;
  if (key === "today") return [today, today];
  if (key === "week") return [addDays(today, -((dayOfWeek(today) + 6) % 7)), today];
  if (key === "lastmonth") {
    const lastEnd = addDays(monthStart, -1);
    return [`${lastEnd.slice(0, 8)}01`, lastEnd];
  }
  return [monthStart, today];
}

export default async function ReportsPage({ searchParams }: { searchParams: { range?: string; from?: string; to?: string } }) {
  await requireUser(["OWNER"]);
  const today = todayInManila();
  const key = searchParams.range ?? "month";
  let [from, to] = rangeFor(key, today);
  if (key === "custom" && valid(searchParams.from) && valid(searchParams.to)) [from, to] = [searchParams.from!, searchParams.to!];
  if (from > to) [from, to] = [to, from];
  const [r, op] = await Promise.all([reportData(from, to), openPlayTotals(from, to)]);
  const maxDay = Math.max(1, ...r.byDay.map((d) => d.value));
  const maxPeak = Math.max(1, ...r.peakHours.map((p) => p.count));
  const maxWd = Math.max(1, ...r.byWeekday);

  const presets: [string, string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"]];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Reports</h1>
          <p className="text-muted">{fmt(from, { month: "long", day: "numeric", year: "numeric" })} to {fmt(to, { month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <a href={`/admin/reports/export?from=${from}&to=${to}`} className="rounded-xl border border-line bg-white px-4 py-2 font-bold">Download for Excel (CSV)</a>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        {presets.map(([k, label]) => (
          <Link key={k} href={`/admin/reports?range=${k}`} className={`rounded-lg px-3 py-2 text-sm font-bold ${key === k ? "bg-court text-white" : "border border-line bg-white"}`}>{label}</Link>
        ))}
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="range" value="custom" />
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" aria-label="From" />
          <input type="date" name="to" defaultValue={to} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" aria-label="To" />
          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold">Show</button>
        </form>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Money collected" value={peso(r.collected.total)} sub={`GCash ${peso(r.collected.gcash)}, cash ${peso(r.collected.cash)}`} />
        <Stat label="Value of bookings" value={peso(r.value.total)} sub={`${r.bookingsCount} bookings, ${r.walkIns} walk-in`} />
        <Stat label="Court booked" value={`${Math.round(r.court.occupancy * 100)}%`} sub={`${r.court.hoursBooked} of ${r.court.hoursAvailable} open hours`} />
        <Stat label="Pool guests" value={String(r.pool.adults + r.pool.kids)} sub={`${r.pool.adults} adults, ${r.pool.kids} kids`} />
        <Stat label="Open play collected" value={peso(op.total)} sub={`${op.players} players · GCash ${peso(op.gcash)}, cash ${peso(op.cash)}`} />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-xl font-semibold">Income split</h2>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1 font-normal" /><th className="font-normal">Day</th><th className="font-normal">Night</th><th className="text-right font-normal">Total</th></tr></thead>
            <tbody>
              <tr className="border-t border-line"><td className="py-2 font-bold">Court</td><td>{peso(r.value.courtDay)}</td><td>{peso(r.value.courtNight)}</td><td className="text-right font-bold">{peso(r.value.court)}</td></tr>
              <tr className="border-t border-line"><td className="py-2 font-bold">Pool</td><td>{peso(r.value.poolDay)}</td><td>{peso(r.value.poolNight)}</td><td className="text-right font-bold">{peso(r.value.pool)}</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted">
            Collected by amenity: court {peso(r.collected.court)}, pool {peso(r.collected.pool)}. Pool guests: day {r.pool.dayGuests}, night {r.pool.nightGuests}.
            No-shows: {r.noShows}. Cancelled: {r.cancelled}.
          </p>
          <p className="mt-2 text-xs text-muted">“Collected” is money actually received in this period. “Value” is the full price of bookings dated in this period, including balances still to be paid on-site.</p>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-xl font-semibold">Busiest court hours</h2>
          <ul className="mt-3 grid gap-1 text-sm">
            {r.peakHours.map((p) => (
              <li key={p.minute} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2">
                <span className="text-muted">{formatMinute(p.minute)}</span>
                <span className="h-3 rounded bg-line"><span className="block h-full rounded bg-court" style={{ width: `${(p.count / maxPeak) * 100}%` }} /></span>
                <span className="text-right">{p.count}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-5 font-bold">Bookings by weekday</h3>
          <ul className="mt-2 grid grid-cols-7 items-end gap-1 text-center text-xs">
            {r.byWeekday.map((n, i) => (
              <li key={i}>
                <span className="mx-auto block w-6 rounded-t bg-pool" style={{ height: `${Math.max(2, (n / maxWd) * 60)}px` }} />
                <span className="block text-muted">{WEEKDAYS[i]}</span>
                <span className="block">{n}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-xl font-semibold">Day by day</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-normal">Date</th><th className="font-normal">Bookings</th><th className="font-normal">Court hrs</th>
                <th className="font-normal">Pool guests</th><th className="w-1/3 font-normal">Value</th><th className="text-right font-normal">Collected</th>
              </tr>
            </thead>
            <tbody>
              {r.byDay.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1.5">{fmt(d.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td>{d.bookings}</td>
                  <td>{d.courtHours}</td>
                  <td>{d.poolGuests}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 flex-1 rounded bg-line"><span className="block h-full rounded bg-court" style={{ width: `${(d.value / maxDay) * 100}%` }} /></span>
                      <span className="w-16 text-right">{peso(d.value)}</span>
                    </span>
                  </td>
                  <td className="text-right">{peso(d.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
