import Link from "next/link";
import type { dayView } from "@/lib/admin-data";
import { formatPeso } from "@/lib/pricing";
import { formatMinute } from "@/lib/time";
import StatusBadge from "./StatusBadge";

type Day = Awaited<ReturnType<typeof dayView>>;
const peso = (c: number) => formatPeso(c).replace(".00", "");

/** Court timelines (one per court) + pool sessions for one day (used by Today and Calendar). */
export default function DaySchedule({ day }: { day: Day }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className={`grid content-start gap-6 ${day.courts.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {day.courts.map((court) => (
          <section key={court.id}>
            <h2 className="font-display text-xl font-semibold">{day.courts.length > 1 ? court.name : "Pickleball court"}</h2>
            <ol className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
              {court.rows.map((r) => {
                const time = `${formatMinute(r.startMinute)}–${formatMinute(r.endMinute)}`;
                const night = r.isNight ? "border-l-4 border-l-dusk" : "border-l-4 border-l-transparent";
                if (r.type === "free")
                  return (
                    <li key={r.startMinute} className={`flex items-center gap-3 border-t border-line px-3 py-2 text-sm text-muted first:border-t-0 ${night}`}>
                      <span className="w-36 shrink-0">{time}</span>
                      <span>Free</span>
                    </li>
                  );
                const b = r.booking;
                const due = b.totalCentavos - b.paidCentavos;
                return (
                  <li key={r.startMinute} className={`border-t border-line first:border-t-0 ${night}`}>
                    <Link href={`/admin/bookings/${b.id}`} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-paper ${b.kind === "BLOCK" ? "bg-ink/5" : ""}`}>
                      <span className="w-36 shrink-0 font-bold">{time}</span>
                      <span className="min-w-0 flex-1">
                        {b.kind === "BLOCK" ? (
                          <span className="font-bold">{b.notes ?? "Blocked"}</span>
                        ) : (
                          <>
                            <span className="font-bold">{b.customerName}</span>{" "}
                            <span className="text-sm text-muted">{b.referenceCode}{b.source === "WALK_IN" ? ", walk-in" : ""}</span>
                          </>
                        )}
                      </span>
                      {b.kind === "BOOKING" && due > 0 && ["CONFIRMED", "CHECKED_IN"].includes(b.status) && (
                        <span className="text-sm">Balance {peso(due)}</span>
                      )}
                      {b.attention && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Needs attention</span>}
                      <StatusBadge status={b.status} kind={b.kind} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <p className="-mt-4 text-sm text-muted xl:col-span-2">Rows with a blue edge are night-rate hours.</p>
      </div>

      <section>
        <h2 className="font-display text-xl font-semibold">Swimming pool</h2>
        <div className="mt-3 grid gap-4">
          {day.sessions.map((s) => (
            <div key={s.id} className="rounded-2xl border border-line bg-white">
              <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <p className="font-bold">{s.name}</p>
                  <p className="text-sm text-muted">{formatMinute(s.startMinute)}–{formatMinute(s.endMinute)}</p>
                </div>
                <p className="font-display text-2xl font-semibold">
                  {s.reserved}<span className="text-base text-muted">/{s.capacity}</span>
                </p>
              </div>
              {s.isClosed && <p className="bg-ink/5 px-4 py-2 text-sm font-bold">Closed: {s.closedReason}</p>}
              {s.bookings.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">No bookings yet.</p>
              ) : (
                <ul>
                  {s.bookings.map((b) => (
                    <li key={b.id} className="border-t border-line first:border-t-0">
                      <Link href={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-paper">
                        <span className="min-w-0 flex-1">
                          <span className="font-bold">{b.customerName}</span>{" "}
                          <span className="text-sm text-muted">{b.adults}A{b.kids ? ` ${b.kids}K` : ""}, {b.referenceCode}</span>
                        </span>
                        {b.attention && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Needs attention</span>}
                        <StatusBadge status={b.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
