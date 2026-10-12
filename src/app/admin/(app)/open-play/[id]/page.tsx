import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { amountDue, openPlayBoard, sessionDate, sessionLabel } from "@/lib/open-play";
import { PLAYERS_PER_GAME } from "@/lib/open-play-core";
import { formatPeso } from "@/lib/pricing";
import { todayInManila } from "@/lib/time";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import AutoRefresh from "@/components/AutoRefresh";
import {
  addOpenPlayPlayerAction, cancelOpenPlayAction, checkOutOpenPlayAction, closeOpenPlayAction,
  finishOpenPlayGameAction, moveOpenPlayToBackAction, restOpenPlayAction, startOpenPlayGameAction,
} from "@/app/admin/actions";

const peso = (c: number) => formatPeso(c).replace(".00", "");
const time = (d: Date) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(d);

type Player = { id: string; name: string; checkedInAt: Date; gamesPlayed: number; mobile: string | null };
type Session = { id: string; date: Date; startMinute: number; endMinute: number; rateCentavosPerHour: number };

function CheckOut({ session, player }: { session: Session; player: Player }) {
  const due = amountDue(session, player);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-bold">Check out</summary>
      <ActionForm action={checkOutOpenPlayAction} submitLabel={`Paid ${peso(due.centavos)}, check out`} className="mt-2 grid gap-2 rounded-xl border border-line bg-paper p-3">
        <input type="hidden" name="playerId" value={player.id} />
        <p className="text-sm">
          In since {time(player.checkedInAt)} · <b>{due.hours} hr</b> × {peso(session.rateCentavosPerHour)} = <b>{peso(due.centavos)}</b>
        </p>
        {due.centavos > 0 && (
          <>
            <label className={labelCls}>Paid with
              <select name="method" className={inputCls} defaultValue="CASH">
                <option value="CASH">Cash</option>
                <option value="GCASH_MANUAL">GCash</option>
              </select>
            </label>
            <label className={labelCls}>GCash Ref. No. (if GCash)<input name="gcashRef" inputMode="numeric" className={inputCls} /></label>
          </>
        )}
      </ActionForm>
    </details>
  );
}

export default async function OpenPlayConsole({ params }: { params: { id: string } }) {
  await requireUser();
  const board = await openPlayBoard(params.id);
  if (!board) notFound();
  const { session: s, onCourt, line, resting, out } = board;
  const live = s.status === "SCHEDULED";
  const isToday = sessionDate(s) === todayInManila();
  const checkedIn = onCourt.length + line.length + resting.length;
  const collected = out.reduce((t, p) => t + (p.amountCentavos ?? 0), 0);

  return (
    <div>
      {live && isToday && <AutoRefresh everyMs={10_000} maxTimes={2000} />}
      <Link href="/admin/open-play" className="text-sm text-muted hover:underline">← All open play</Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Open play</h1>
          <p className="text-muted">
            {sessionLabel(s)} · {peso(s.rateCentavosPerHour)}/hr · {checkedIn}/{s.maxPlayers} players · {s.gamesPlayed} games
            {s.status !== "SCHEDULED" && <b className="ml-2 text-red-700">{s.status === "CLOSED" ? "CLOSED" : "CANCELLED"}</b>}
          </p>
        </div>
        <a href="/open-play" target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold">TV screen ↗</a>
      </div>

      {live && !isToday && (
        <p className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
          Players can be added on the day itself. Come back to this page on {sessionLabel(s).split(",").slice(0, 2).join(",")}.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-6">
          {/* Court */}
          <section className="rounded-3xl bg-court p-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">On court</h2>
              {live && isToday && (
                onCourt.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={finishOpenPlayGameAction} submitLabel="Game over → next 4" pendingLabel="Switching…" tone="plain" className="[&>button]:mt-0">
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="startNext" value="1" />
                    </ActionForm>
                    <ActionForm action={finishOpenPlayGameAction} submitLabel="Game over, pause" pendingLabel="Saving…" tone="plain" className="[&>button]:mt-0 [&>button]:bg-transparent [&>button]:text-white [&>button]:border-white/50">
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="startNext" value="0" />
                    </ActionForm>
                  </div>
                ) : (
                  <ActionForm action={startOpenPlayGameAction} submitLabel={`Start game (next ${PLAYERS_PER_GAME})`} pendingLabel="Starting…" tone="plain" className="[&>button]:mt-0">
                    <input type="hidden" name="sessionId" value={s.id} />
                  </ActionForm>
                )
              )}
            </div>
            {onCourt.length === 0 ? (
              <p className="mt-4 text-white/75">
                {line.length >= PLAYERS_PER_GAME ? "Court is empty. Tap “Start game”." : `Waiting for ${PLAYERS_PER_GAME - line.length} more player(s) in line.`}
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-3">
                {onCourt.map((p) => (
                  <li key={p.id} className="rounded-2xl bg-white/10 p-3">
                    <p className="font-display text-xl font-bold">{p.name}</p>
                    <p className="text-xs text-white/70">{p.gamesPlayed} games so far</p>
                    {live && <div className="mt-2 text-ink"><CheckOut session={s} player={p} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Line */}
          <section>
            <h2 className="font-display text-xl font-semibold">Paddle stack ({line.length} waiting)</h2>
            {line.length === 0 ? <p className="mt-2 text-muted">Nobody in line.</p> : (
              <ol className="mt-3 grid gap-2">
                {line.map((p, i) => (
                  <li key={p.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-4 py-3 ${i < PLAYERS_PER_GAME ? "border-ball border-2" : "border-line"}`}>
                    <span>
                      <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-paper font-bold">{i + 1}</span>
                      <span className="font-bold">{p.name}</span>
                      <span className="ml-2 text-sm text-muted">{i < PLAYERS_PER_GAME ? "next game" : `in ${Math.ceil((i + 1) / PLAYERS_PER_GAME)} games`} · {p.gamesPlayed} played</span>
                    </span>
                    {live && (
                      <span className="flex flex-wrap items-start gap-2">
                        <ActionForm action={moveOpenPlayToBackAction} submitLabel="To back" tone="plain" className="[&>button]:mt-0 [&>button]:py-1.5 [&>button]:text-sm">
                          <input type="hidden" name="playerId" value={p.id} />
                        </ActionForm>
                        <ActionForm action={restOpenPlayAction} submitLabel="Rest" tone="plain" className="[&>button]:mt-0 [&>button]:py-1.5 [&>button]:text-sm">
                          <input type="hidden" name="playerId" value={p.id} />
                          <input type="hidden" name="resting" value="1" />
                        </ActionForm>
                        <CheckOut session={s} player={p} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {resting.length > 0 && (
              <>
                <h3 className="mt-6 font-display text-lg font-semibold">Resting</h3>
                <ul className="mt-2 grid gap-2">
                  {resting.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dashed border-line bg-white px-4 py-3">
                      <span className="font-bold">{p.name}</span>
                      {live && (
                        <span className="flex flex-wrap items-start gap-2">
                          <ActionForm action={restOpenPlayAction} submitLabel="Back in line" tone="plain" className="[&>button]:mt-0 [&>button]:py-1.5 [&>button]:text-sm">
                            <input type="hidden" name="playerId" value={p.id} />
                            <input type="hidden" name="resting" value="0" />
                          </ActionForm>
                          <CheckOut session={s} player={p} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          {live && isToday && (
            <section>
              <h2 className="font-display text-xl font-semibold">Add player</h2>
              <ActionForm action={addOpenPlayPlayerAction} submitLabel="Add to line" className="mt-3 grid gap-3 rounded-2xl border border-line bg-white p-4" resetOnSuccess full>
                <input type="hidden" name="sessionId" value={s.id} />
                <label className={labelCls}>Name or nickname<input name="name" maxLength={30} className={inputCls} required autoComplete="off" /></label>
                <label className={labelCls}>Mobile (optional)<input name="mobile" inputMode="tel" className={inputCls} autoComplete="off" /></label>
                <p className="text-xs text-muted">Only the name appears on the TV screen. Time starts counting now.</p>
              </ActionForm>
            </section>
          )}

          <section>
            <h2 className="font-display text-xl font-semibold">Checked out</h2>
            <p className="text-sm text-muted">Collected: <b className="text-ink">{peso(collected)}</b></p>
            {out.length === 0 ? <p className="mt-2 text-sm text-muted">Nobody yet.</p> : (
              <ul className="mt-2 grid gap-1 text-sm">
                {out.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 rounded-lg bg-white px-3 py-2">
                    <span>{p.name} <span className="text-muted">{time(p.checkedInAt)}–{time(p.checkedOutAt!)}</span></span>
                    <span className="font-bold">
                      {peso(p.amountCentavos ?? 0)}
                      <span className="ml-1 font-normal text-muted">{p.paymentMethod === "GCASH_MANUAL" ? "GCash" : p.paymentMethod === "CASH" ? "cash" : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {live && (
            <section className="grid gap-2">
              {checkedIn === 0 && out.length > 0 && (
                <ActionForm action={closeOpenPlayAction} submitLabel="Close session" tone="plain" full>
                  <input type="hidden" name="sessionId" value={s.id} />
                </ActionForm>
              )}
              {checkedIn === 0 && out.length === 0 && (
                <ActionForm action={cancelOpenPlayAction} submitLabel="Cancel this open play" tone="danger" full confirm="Cancel this open play and open the court for bookings again?">
                  <input type="hidden" name="sessionId" value={s.id} />
                </ActionForm>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
