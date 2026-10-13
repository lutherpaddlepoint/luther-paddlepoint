import type { Metadata } from "next";
import Link from "next/link";
import { currentPublicSession, openPlayBoard, sessionDate, sessionEndAt, sessionLabel, sessionStartAt, upcomingPublicSessions } from "@/lib/open-play";
import { PLAYERS_PER_GAME } from "@/lib/open-play-core";
import { formatPeso } from "@/lib/pricing";
import { todayInManila } from "@/lib/time";
import AutoRefresh from "@/components/AutoRefresh";
import TvClock from "@/components/TvClock";
import LiveScore from "@/components/score/LiveScore";
import Standings from "@/components/score/Standings";
import { liveMatch, matchView, sessionStandings } from "@/lib/scoring";

export const metadata: Metadata = { title: "Open play" };
export const dynamic = "force-dynamic";

const peso = (c: number) => formatPeso(c).replace(".00", "");

// Public screen for the TV by the court, or for players' phones.
// Shows only nicknames: never mobile numbers or amounts.
export default async function OpenPlayScreen() {
  const current = await currentPublicSession();
  const board = current ? await openPlayBoard(current.id) : null;
  const upcoming = await upcomingPublicSessions();
  const today = todayInManila();
  const live = await liveMatch();

  if (!board) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl px-5 py-10">
        <AutoRefresh everyMs={live ? 3_000 : 60_000} maxTimes={live ? 20_000 : 600} />
        {live && (
          <div className="mb-8 rounded-3xl bg-court p-5 text-white">
            <LiveScore m={matchView(live)} size="md" />
          </div>
        )}
        <h1 className="font-display text-4xl font-extrabold text-court">Open play</h1>
        <p className="mt-2 text-lg text-muted">Walk in, put your name on the paddle stack, and play doubles. Pay per hour at the counter.</p>
        <h2 className="mt-8 font-display text-xl font-semibold">Schedule</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-muted">No open play scheduled yet. Check our Facebook page for updates.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {upcoming.map((s) => (
              <li key={s.id} className="rounded-2xl border border-line bg-white px-5 py-4">
                <span className="block font-display text-lg font-semibold">{sessionLabel(s)}</span>
                <span className="text-muted">{peso(s.rateCentavosPerHour)}/hr per player · up to {s.maxPlayers} players{s.notes ? ` · ${s.notes}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/" className="mt-8 inline-block font-bold text-court underline">Book the court instead →</Link>
      </main>
    );
  }

  const { session: s, onCourt, line } = board;
  const isToday = sessionDate(s) === today;
  const upNext = line.slice(0, PLAYERS_PER_GAME);
  const rest = line.slice(PLAYERS_PER_GAME);
  const table = await sessionStandings(s.id);

  return (
    <main className="min-h-screen bg-court px-5 py-6 text-white md:px-10">
      <AutoRefresh everyMs={5_000} maxTimes={20_000} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ball">Open play</p>
          <h1 className="font-display text-3xl font-extrabold md:text-4xl">{sessionLabel(s)}</h1>
        </div>
        <div className="flex items-end gap-6">
          <p className="text-white/80">{peso(s.rateCentavosPerHour)}/hr · Game {s.gamesPlayed + (onCourt.length ? 1 : 0)}</p>
          <TvClock startsAt={sessionStartAt(s).toISOString()} endsAt={sessionEndAt(s).toISOString()} />
        </div>
      </header>

      {!isToday && <p className="mt-6 text-white/80">Not started yet.</p>}

      {live && <div className="mt-6"><LiveScore m={matchView(live)} size="md" /></div>}

      <section className="mt-6">
        <h2 className="font-display text-xl font-semibold text-white/80">On court</h2>
        {onCourt.length === 0 ? (
          <p className="mt-2 text-2xl text-white/70">{line.length >= PLAYERS_PER_GAME ? "Next game starting soon" : "Waiting for players"}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {onCourt.map((p) => (
              <li key={p.id} className="rounded-2xl bg-white/10 px-4 py-5 text-center font-display text-3xl font-extrabold md:text-5xl">{p.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold text-ball">Up next</h2>
        {upNext.length === 0 ? <p className="mt-2 text-white/70">Nobody in line.</p> : (
          <ol className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {upNext.map((p, i) => (
              <li key={p.id} className="rounded-2xl bg-ball px-4 py-4 text-center font-display text-2xl font-bold text-ink md:text-4xl">
                <span className="block text-sm font-semibold opacity-70">#{i + 1}</span>{p.name}
              </li>
            ))}
          </ol>
        )}
      </section>

      {rest.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold text-white/80">In line</h2>
          <ol className="mt-3 flex flex-wrap gap-2">
            {rest.map((p, i) => (
              <li key={p.id} className="rounded-xl bg-white/10 px-3 py-2 text-lg md:text-2xl">
                <span className="mr-1 text-white/60">{i + PLAYERS_PER_GAME + 1}.</span>{p.name}
              </li>
            ))}
          </ol>
        </section>
      )}

      {table.length > 0 && (
        <section className="mt-8 max-w-2xl">
          <h2 className="font-display text-xl font-semibold text-ball">Tonight&rsquo;s leaderboard</h2>
          <div className="mt-2 text-lg md:text-xl"><Standings rows={table} limit={10} dark /></div>
        </section>
      )}
    </main>
  );
}
