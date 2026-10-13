import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatMinute, manilaToUtc, todayInManila, utcToManila } from "@/lib/time";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import HourSelect from "@/components/admin/HourSelect";
import { blockAction, poolClosureAction, removeBlockAction } from "@/app/admin/actions";

export default async function BlocksPage() {
  await requireUser(["OWNER"]);
  const settings = await getSettings();
  const today = todayInManila();
  const { openMinute, closeMinute } = settings.operating_hours;
  const [blocks, sessions, closures, courts] = await Promise.all([
    prisma.booking.findMany({
      where: { kind: "BLOCK", status: "CONFIRMED", endAt: { gt: manilaToUtc(today, 0) } },
      orderBy: { startAt: "asc" },
      include: { amenity: { select: { name: true } } },
    }),
    prisma.poolSession.findMany({ where: { isActive: true }, orderBy: { startMinute: "asc" } }),
    prisma.poolSessionInventory.findMany({
      where: { isClosed: true, date: { gte: new Date(`${today}T00:00:00Z`) } },
      include: { poolSession: true },
      orderBy: { date: "asc" },
    }),
    prisma.amenity.findMany({ where: { type: "COURT", isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-2xl font-extrabold">{courts.length > 1 ? "Block a court" : "Block the court"}</h1>
        <p className="mt-1 text-muted">For maintenance, events or tournaments. Customers will see these hours as closed.</p>
        <ActionForm action={blockAction} submitLabel="Block these hours" className="mt-4 grid gap-3 rounded-2xl border border-line bg-white p-5" resetOnSuccess>
          {courts.length > 1 ? (
            <label className={labelCls}>Court
              <select name="courtId" className={inputCls} defaultValue="ALL">
                <option value="ALL">All courts</option>
                {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : <input type="hidden" name="courtId" value={courts[0]?.id ?? ""} />}
          <label className={labelCls}>Date<input type="date" name="date" min={today} defaultValue={today} className={inputCls} required /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>From<HourSelect name="start" from={openMinute} to={closeMinute - 60} className={inputCls} /></label>
            <label className={labelCls}>To<HourSelect name="end" from={openMinute + 60} to={closeMinute} defaultMinute={closeMinute} className={inputCls} /></label>
          </div>
          <label className={labelCls}>Reason<input name="reason" className={inputCls} placeholder="e.g. Court resurfacing" required /></label>
        </ActionForm>

        <h2 className="mt-8 font-display text-xl font-semibold">Upcoming court blocks</h2>
        {blocks.length === 0 ? <p className="mt-2 text-muted">None.</p> : (
          <ul className="mt-3 grid gap-2">
            {blocks.map((b) => {
              const s = utcToManila(b.startAt);
              const e = utcToManila(b.endAt);
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-2">
                  <Link href={`/admin/bookings/${b.id}`} className="hover:underline">
                    <span className="font-bold">{s.date}, {formatMinute(s.minuteOfDay)}–{formatMinute(e.minuteOfDay)}</span>
                    {courts.length > 1 && <span className="ml-2 text-sm font-bold text-court">{b.amenity.name}</span>}
                    <span className="block text-sm text-muted">{b.notes}</span>
                  </Link>
                  <ActionForm action={removeBlockAction} submitLabel="Remove" tone="plain" confirm="Open this time for bookings again?">
                    <input type="hidden" name="bookingId" value={b.id} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl font-extrabold">Close the pool</h2>
        <p className="mt-1 text-muted">Closes one session for one date. Existing bookings are not cancelled; you’ll get a list of people to contact.</p>
        <ActionForm action={poolClosureAction} submitLabel="Close session" className="mt-4 grid gap-3 rounded-2xl border border-line bg-white p-5">
          <input type="hidden" name="closed" value="1" />
          <label className={labelCls}>Date<input type="date" name="date" min={today} defaultValue={today} className={inputCls} required /></label>
          <label className={labelCls}>Session
            <select name="sessionId" className={inputCls}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMinute(s.startMinute)}–{formatMinute(s.endMinute)})</option>)}
            </select>
          </label>
          <label className={labelCls}>Reason<input name="reason" className={inputCls} placeholder="e.g. Pool cleaning" required /></label>
        </ActionForm>

        <h2 className="mt-8 font-display text-xl font-semibold">Upcoming pool closures</h2>
        {closures.length === 0 ? <p className="mt-2 text-muted">None.</p> : (
          <ul className="mt-3 grid gap-2">
            {closures.map((c) => {
              const date = c.date.toISOString().slice(0, 10);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-2">
                  <span>
                    <span className="font-bold">{date}, {c.poolSession.name}</span>
                    <span className="block text-sm text-muted">{c.closedReason}</span>
                  </span>
                  <ActionForm action={poolClosureAction} submitLabel="Reopen" tone="plain">
                    <input type="hidden" name="closed" value="0" />
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="sessionId" value={c.poolSessionId} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
