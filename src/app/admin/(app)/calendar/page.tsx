import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { dayView, weekView } from "@/lib/admin-data";
import { addDays, dayOfWeek, manilaToUtc, todayInManila } from "@/lib/time";
import DaySchedule from "@/components/admin/DaySchedule";

const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...o }).format(manilaToUtc(d, 720));
const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
const CELL: Record<string, string> = {
  BLOCK: "bg-ink text-white",
  HOLD: "bg-ball/60 text-ink",
  PENDING_VERIFICATION: "bg-dusk text-white",
  CONFIRMED: "bg-court text-white",
  CHECKED_IN: "bg-pool text-white",
  COMPLETED: "bg-line text-ink",
};

export default async function CalendarPage({ searchParams }: { searchParams: { date?: string; view?: string } }) {
  await requireUser();
  const today = todayInManila();
  const date = valid(searchParams.date) ?? today;
  const view = searchParams.view === "week" ? "week" : "day";
  const step = view === "week" ? 7 : 1;
  // Week view starts on Monday
  const weekStart = addDays(date, -((dayOfWeek(date) + 6) % 7));
  const href = (d: string, v = view) => `/admin/calendar?date=${d}&view=${v}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">
          {view === "day"
            ? fmt(date, { weekday: "long", month: "long", day: "numeric" })
            : `Week of ${fmt(weekStart, { month: "long", day: "numeric" })}`}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line bg-white text-sm font-bold">
            <Link href={href(date, "day")} className={`px-3 py-2 ${view === "day" ? "bg-court text-white" : ""}`}>Day</Link>
            <Link href={href(date, "week")} className={`px-3 py-2 ${view === "week" ? "bg-court text-white" : ""}`}>Week</Link>
          </div>
          <Link href={href(addDays(date, -step))} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" aria-label="Previous">‹</Link>
          <Link href={href(today)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold">Today</Link>
          <Link href={href(addDays(date, step))} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" aria-label="Next">›</Link>
          <form action="/admin/calendar" className="flex gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="date" name="date" defaultValue={date} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" />
            <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold">Go</button>
          </form>
        </div>
      </div>

      <div className="mt-6">{view === "day" ? <DaySchedule day={await dayView(date)} /> : <Week start={weekStart} today={today} />}</div>
    </div>
  );
}

async function Week({ start, today }: { start: string; today: string }) {
  const w = await weekView(start);
  return (
    <div className="grid gap-8">
      <section>
        <h2 className="font-display text-xl font-semibold">Pickleball court</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-20" />
                {w.days.map((d) => (
                  <th key={d} className={`px-1 py-2 text-left font-bold ${d === today ? "text-court" : ""}`}>
                    <Link href={`/admin/calendar?date=${d}&view=day`} className="hover:underline">
                      {fmt(d, { weekday: "short" })} {fmt(d, { day: "numeric" })}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.grid.map((row) => (
                <tr key={row.minute} className={row.isNight ? "bg-dusk/5" : ""}>
                  <th className="whitespace-nowrap border-t border-line px-2 py-1 text-left font-normal text-muted">{row.label}</th>
                  {row.cells.map((c, i) => (
                    <td key={i} className="border-l border-t border-line p-0.5">
                      {c ? (
                        <Link href={`/admin/bookings/${c.id}`} className={`block truncate rounded px-1 py-1 ${CELL[c.kind === "BLOCK" ? "BLOCK" : c.status] ?? "bg-line"}`}>
                          {c.label || "Booked"}
                        </Link>
                      ) : (
                        <span className="block py-1">&nbsp;</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-court align-middle" />Confirmed</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-dusk align-middle" />Check payment</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-ball/60 align-middle" />Unpaid hold</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-pool align-middle" />Checked in</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded bg-ink align-middle" />Blocked</span>
        </p>
      </section>

      <section>
        <h2 className="font-display text-xl font-semibold">Swimming pool (guests booked)</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[760px] table-fixed text-sm">
            <tbody>
              {w.poolRows.map((r) => (
                <tr key={r.name}>
                  <th className="w-28 border-t border-line px-2 py-2 text-left font-bold first:border-t-0">{r.name}</th>
                  {r.cells.map((c, i) => (
                    <td key={i} className="border-l border-t border-line px-2 py-2">
                      {c.closed ? <span className="font-bold">Closed</span> : (
                        <>
                          <span className="font-bold">{c.reserved}</span>/{c.capacity}
                          <span className="mt-1 block h-1.5 overflow-hidden rounded bg-line">
                            <span className="block h-full bg-pool" style={{ width: `${Math.round((c.reserved / c.capacity) * 100)}%` }} />
                          </span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
