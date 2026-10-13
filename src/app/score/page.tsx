import type { Metadata } from "next";
import Link from "next/link";
import { liveMatch, matchView, recentMatches } from "@/lib/scoring";
import LiveScore from "@/components/score/LiveScore";
import AutoRefresh from "@/components/AutoRefresh";
import TvClock from "@/components/TvClock";
import TvCountdown from "@/components/TvCountdown";
import { getCourtTimer } from "@/lib/court-timer";
import { courtFromParam } from "@/lib/courts";

export const metadata: Metadata = { title: "Live score" };
export const dynamic = "force-dynamic";

// Full-screen scoreboard for the TV by one court (court bookings and open play).
// Each court has its own screen: /score?court=1, /score?court=2 (no number = the first court).
export default async function ScorePage({ searchParams }: { searchParams: { court?: string } }) {
  const { court, courts } = await courtFromParam(searchParams.court);
  if (!court) {
    return (
      <main className="grid min-h-screen place-items-center bg-court px-5 text-white">
        <p className="font-display text-3xl text-white/70">No court is set up yet.</p>
      </main>
    );
  }
  const live = await liveMatch(court.id);
  // After a game, keep showing the final score for 15 minutes.
  const recent = live ? null : (await recentMatches(1, court.id))[0] ?? null;
  const last = recent?.finishedAt && Date.now() - recent.finishedAt.getTime() < 15 * 60_000 ? recent : null;
  const shown = live ?? last;
  const timer = await getCourtTimer(court.id);
  return (
    <main className="min-h-screen bg-court px-5 py-6 text-white md:px-10">
      <AutoRefresh everyMs={2_000} maxTimes={50_000} />
      <div className="flex items-start justify-between gap-4">
        <p className="font-display text-lg font-semibold text-ball md:text-2xl">Luther PaddlePoint · {court.short}</p>
        <TvClock />
      </div>
      {timer && (
        <div className="mt-4">
          <TvCountdown endsAt={timer.endsAt} label={timer.label} serverNow={Date.now()} />
        </div>
      )}
      <div className="mt-4">
        {shown ? <LiveScore m={matchView(shown)} /> : !timer && (
          <p className="mt-20 text-center font-display text-3xl text-white/70">No match on {court.short} right now.</p>
        )}
      </div>
      <div className="mt-8 flex flex-wrap gap-4 text-sm text-white/60">
        <Link href={`/open-play?court=${court.number}`} className="underline">Open play line &amp; leaderboard</Link>
        {courts.length > 1 && courts.filter((c) => c.id !== court.id).map((c) => (
          <Link key={c.id} href={`/score?court=${c.number}`} className="underline">{c.short} screen</Link>
        ))}
      </div>
    </main>
  );
}
