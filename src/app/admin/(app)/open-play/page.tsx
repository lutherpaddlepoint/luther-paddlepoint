import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { listOpenPlay, sessionDate, sessionLabel } from "@/lib/open-play";
import { formatPeso } from "@/lib/pricing";
import { todayInManila } from "@/lib/time";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import HourSelect from "@/components/admin/HourSelect";
import { createOpenPlayAction } from "@/app/admin/actions";

const peso = (c: number) => formatPeso(c).replace(".00", "");

export default async function OpenPlayPage() {
  await requireUser();
  const settings = await getSettings();
  const today = todayInManila();
  const { openMinute, closeMinute } = settings.operating_hours;
  const sessions = await listOpenPlay(today);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-extrabold">Open play</h1>
            <p className="text-muted">Paddle stacking: first 4 in line play, then all 4 go to the back.</p>
          </div>
          <a href="/open-play" target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold">
            Open the TV screen ↗
          </a>
        </div>

        {sessions.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line bg-white px-5 py-8 text-center text-muted">
            No open play scheduled. Add one with the form.
          </p>
        ) : (
          <ul className="mt-6 grid gap-3">
            {sessions.map((s) => {
              const isToday = sessionDate(s) === today;
              return (
                <li key={s.id}>
                  <Link
                    href={`/admin/open-play/${s.id}`}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 hover:border-court ${
                      isToday ? "border-court bg-court/5" : "border-line bg-white"
                    }`}
                  >
                    <span>
                      <span className="block font-display text-lg font-semibold">
                        {isToday && <span className="mr-2 rounded bg-ball px-1.5 py-0.5 text-xs text-ink">TODAY</span>}
                        {sessionLabel(s)}
                      </span>
                      <span className="text-sm text-muted">
                        {peso(s.rateCentavosPerHour)}/hr per player · up to {s.maxPlayers} players
                        {s.notes ? ` · ${s.notes}` : ""}
                      </span>
                    </span>
                    <span className="text-sm font-bold text-court">
                      {s.status === "CLOSED" ? "Closed" : `${s._count.players} checked in →`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-xl font-semibold">Schedule open play</h2>
        <p className="mt-1 text-sm text-muted">The court is blocked for these hours, so nobody can book it.</p>
        <ActionForm action={createOpenPlayAction} submitLabel="Schedule" className="mt-3 grid gap-3 rounded-2xl border border-line bg-white p-5">
          <label className={labelCls}>Date<input type="date" name="date" min={today} defaultValue={today} className={inputCls} required /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>From<HourSelect name="start" from={openMinute} to={closeMinute - 60} defaultMinute={18 * 60} className={inputCls} /></label>
            <label className={labelCls}>To<HourSelect name="end" from={openMinute + 60} to={closeMinute} defaultMinute={21 * 60} className={inputCls} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Price per hour (₱)<input name="rate" inputMode="decimal" placeholder="e.g. 50" className={inputCls} required /></label>
            <label className={labelCls}>Max players<input name="maxPlayers" type="number" min={4} max={60} defaultValue={16} className={inputCls} required /></label>
          </div>
          <label className={labelCls}>Note (optional)<input name="notes" maxLength={60} placeholder="e.g. Beginners night" className={inputCls} /></label>
        </ActionForm>
      </section>
    </div>
  );
}
