import type { MatchView } from "@/lib/scoring";
import { tvOrder } from "@/lib/scoring-core";

/** Big scoreboard for the TV / phones. Server component; the page refreshes it. */
export default function LiveScore({ m, size = "lg" }: { m: MatchView; size?: "lg" | "md" }) {
  const big = size === "lg";
  const side = (t: "A" | "B") => {
    const names = t === "A" ? m.teamA : m.teamB;
    const score = t === "A" ? m.scoreA : m.scoreB;
    const serving = m.serving === t && !m.winner;
    const won = m.winner === t;
    return (
      <div className={`rounded-3xl p-4 text-center ${won ? "bg-ball text-ink" : serving ? "bg-white/15 ring-2 ring-ball" : "bg-white/10"}`}>
        <p className={`font-display font-bold ${big ? "text-2xl md:text-4xl" : "text-xl"}`}>{names.join(" & ")}</p>
        <p className={`font-display font-extrabold leading-none ${big ? "text-[7rem] md:text-[11rem]" : "text-7xl"}`}>{score}</p>
        <p className="h-6 text-sm font-bold text-ball">{serving ? `● Serving (${m.server})` : won ? "WINNER" : ""}</p>
      </div>
    );
  };
  return (
    <section aria-label="Live score">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className={`font-display font-semibold ${big ? "text-2xl" : "text-xl"} text-white/80`}>
          {m.winner ? "Final" : "Live score"} <span className="text-white/50">· to {m.target}</span>
        </h2>
        {!m.winner && <p className={`font-display font-extrabold tracking-wider text-ball ${big ? "text-4xl md:text-5xl" : "text-3xl"}`}>{m.call}</p>}
      </div>
      {m.switchSides && <p className="mt-2 rounded-xl bg-pool px-4 py-2 text-center text-lg font-bold">Switch sides</p>}
      {m.gamePoint && <p className="mt-2 rounded-xl bg-white px-4 py-2 text-center text-lg font-bold text-court">Game point</p>}
      {/* Serving team on the left, so the order matches the call ("serving-receiving-server"). */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {tvOrder(m).map((t) => <div key={t} className="contents">{side(t)}</div>)}
      </div>
    </section>
  );
}
