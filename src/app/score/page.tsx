import type { Metadata } from "next";
import Link from "next/link";
import { liveMatch, matchView, recentMatches } from "@/lib/scoring";
import LiveScore from "@/components/score/LiveScore";
import AutoRefresh from "@/components/AutoRefresh";
import TvClock from "@/components/TvClock";
import TvCountdown from "@/components/TvCountdown";
import { getCourtTimer } from "@/lib/court-timer";

export const metadata: Metadata = { title: "Live score" };
export const dynamic = "force-dynamic";

// Full-screen scoreboard for the TV by the court (court bookings and open play).
export default async function ScorePage() {
  const live = await liveMatch();
  // After a game, keep showing the final score for 15 minutes.
  const recent = live ? null : (await recentMatches(1))[0] ?? null;
  const last = recent?.finishedAt && Date.now() - recent.finishedAt.getTime() < 15 * 60_000 ? recent : null;
  const shown = live ?? last;
  const timer = await getCourtTimer();
  return (
    <main className="min-h-screen bg-court px-5 py-6 text-white md:px-10">
      <AutoRefresh everyMs={2_000} maxTimes={50_000} />
      <div className="flex items-start justify-between gap-4">
        <p className="font-display text-lg font-semibold text-ball">Luther PaddlePoint · Court 1</p>
        <TvClock />
      </div>
      {timer && (
        <div className="mt-4">
          <TvCountdown endsAt={timer.endsAt} label={timer.label} serverNow={Date.now()} />
        </div>
      )}
      <div className="mt-4">
        {shown ? <LiveScore m={matchView(shown)} /> : !timer && (
          <p className="mt-20 text-center font-display text-3xl text-white/70">No match on court right now.</p>
        )}
      </div>
      <Link href="/open-play" className="mt-8 inline-block text-sm text-white/60 underline">Open play line &amp; leaderboard</Link>
    </main>
  );
}
