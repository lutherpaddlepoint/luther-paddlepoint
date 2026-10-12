import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getRefereeToken, liveMatch, matchView, periodStandings, recentMatches } from "@/lib/scoring";
import { qrSvg } from "@/lib/qr";
import { addDays, dayOfWeek, manilaToUtc, todayInManila } from "@/lib/time";
import ActionForm from "@/components/admin/ActionForm";
import Standings from "@/components/score/Standings";
import AutoRefresh from "@/components/AutoRefresh";
import { abandonMatchAction, newRefereeLinkAction } from "@/app/admin/actions";

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

function siteOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

export default async function ScoreboardAdmin({ searchParams }: { searchParams: { range?: string } }) {
  const user = await requireUser();
  const today = todayInManila();
  const range = searchParams.range === "today" ? "today" : searchParams.range === "week" ? "week" : "month";
  const from = range === "today" ? today : range === "week" ? addDays(today, -((dayOfWeek(today) + 6) % 7)) : `${today.slice(0, 8)}01`;
  const [token, live, board, recent] = await Promise.all([
    getRefereeToken(), liveMatch(), periodStandings(manilaToUtc(from, 0), manilaToUtc(today, 1440)), recentMatches(15),
  ]);
  const refUrl = `${siteOrigin()}/ref/${token}`;
  const qr = await qrSvg(refUrl);

  return (
    <div>
      {live && <AutoRefresh everyMs={5_000} maxTimes={5000} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Scoreboard</h1>
          <p className="text-muted">The referee taps who won each rally. Side-out scoring, games to 11, 15 or 21, win by 2.</p>
        </div>
        <a href="/score" target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold">TV score screen ↗</a>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-6">
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Now on court</h2>
            {live ? (() => {
              const v = matchView(live);
              return (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-lg">
                    <b>{v.teamA.join(" & ")}</b> <span className="font-display text-2xl font-extrabold">{v.scoreA}</span>
                    <span className="mx-2 text-muted">vs</span>
                    <span className="font-display text-2xl font-extrabold">{v.scoreB}</span> <b>{v.teamB.join(" & ")}</b>
                    <span className="ml-2 text-sm text-muted">({v.winner ? "waiting for referee to save" : v.call}, to {v.target})</span>
                  </p>
                  <ActionForm action={abandonMatchAction} submitLabel="Cancel match" tone="plain" confirm="Cancel this match without saving a result?" className="[&>button]:mt-0">
                    <input type="hidden" name="matchId" value={live.id} />
                  </ActionForm>
                </div>
              );
            })() : <p className="mt-2 text-muted">No match being scored.</p>}
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">Leaderboard</h2>
              <div className="flex gap-1">
                {(["today", "week", "month"] as const).map((r) => (
                  <Link key={r} href={`/admin/scoreboard?range=${r}`}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold ${range === r ? "bg-court text-white" : "border border-line bg-white"}`}>
                    {r === "today" ? "Today" : r === "week" ? "This week" : "This month"}
                  </Link>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted">{board.matches} game(s). Names are matched as typed, so ask players to use the same name each time.</p>
            <div className="mt-3 rounded-2xl border border-line bg-white p-4"><Standings rows={board.rows} limit={30} /></div>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold">Recent results</h2>
            {recent.length === 0 ? <p className="mt-2 text-muted">None yet.</p> : (
              <ul className="mt-2 grid gap-1">
                {recent.map((m) => (
                  <li key={m.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                    <span>
                      <b className={m.winner === "A" ? "text-court" : ""}>{m.teamA.join(" & ")}</b> {m.scoreA}–{m.scoreB}{" "}
                      <b className={m.winner === "B" ? "text-court" : ""}>{m.teamB.join(" & ")}</b>
                      {m.openPlaySessionId && <span className="ml-2 rounded bg-paper px-1.5 text-xs text-muted">open play</span>}
                    </span>
                    <span className="text-muted">{m.finishedAt ? when(m.finishedAt) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-3">
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Referee link</h2>
            <p className="mt-1 text-sm text-muted">The referee scans this with their phone. No login needed, so only share it with the referee.</p>
            <div className="mx-auto mt-3 w-56" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="mt-2 break-all rounded-lg bg-paper px-2 py-1 text-xs">{refUrl}</p>
            {user.role === "OWNER" && (
              <ActionForm action={newRefereeLinkAction} submitLabel="Make a new link" tone="plain" full confirm="Make a new referee link? The old link and QR will stop working.">
                <p className="mt-3 text-xs text-muted">Use this if the link was shared with someone who shouldn&rsquo;t have it.</p>
              </ActionForm>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
