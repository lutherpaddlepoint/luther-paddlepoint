import type { StandingRow } from "@/lib/scoring-core";

/** Leaderboard table: wins, losses, win %, point difference. */
export default function Standings({ rows, limit, dark = false }: { rows: StandingRow[]; limit?: number; dark?: boolean }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (shown.length === 0) return <p className={dark ? "text-white/70" : "text-muted"}>No finished games yet.</p>;
  const head = dark ? "text-white/60" : "text-muted";
  const line = dark ? "border-white/15" : "border-line";
  return (
    <table className="w-full text-left">
      <thead>
        <tr className={`text-sm ${head}`}>
          <th className="py-1 pr-2 font-semibold">#</th>
          <th className="py-1 pr-2 font-semibold">Player</th>
          <th className="py-1 pr-2 text-right font-semibold">W</th>
          <th className="py-1 pr-2 text-right font-semibold">L</th>
          <th className="py-1 pr-2 text-right font-semibold">Win %</th>
          <th className="py-1 text-right font-semibold">+/-</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => (
          <tr key={r.name} className={`border-t ${line}`}>
            <td className="py-2 pr-2 font-bold">{i + 1}</td>
            <td className="py-2 pr-2 font-bold">{r.name}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{r.wins}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{r.losses}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{Math.round(r.winPct * 100)}%</td>
            <td className="py-2 text-right tabular-nums">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
