"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refAbandonAction, refConfirmAction, refRallyAction, refUndoAction } from "@/app/ref/actions";
import type { ActionResult } from "@/lib/action-result";
import { courtOrder } from "@/lib/scoring-core";

export type PadMatch = {
  id: string;
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  serving: "A" | "B";
  server: number;
  winner: "A" | "B" | null;
  target: number;
  call: string;
  gamePoint: boolean;
  switchSides: boolean;
  switched: boolean;
  canUndo: boolean;
  openPlay: boolean;
};

/** The referee's phone: two big buttons, one per team. Tap the team that won the rally. */
export default function RefereePad({ token, m }: { token: string; m: PadMatch }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);

  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok && !r.message ? null : r);
      router.refresh();
    });

  const team = (t: "A" | "B") => {
    const names = t === "A" ? m.teamA : m.teamB;
    const score = t === "A" ? m.scoreA : m.scoreB;
    const serving = m.serving === t && !m.winner;
    return (
      <button
        type="button"
        disabled={pending || !!m.winner}
        onClick={() => go(() => refRallyAction(token, m.id, t))}
        className={`flex min-h-[38vh] flex-col items-center justify-center rounded-3xl p-4 text-center transition active:scale-[0.98] disabled:opacity-100 ${
          serving ? "bg-ball text-ink" : "bg-white/10 text-white"
        } ${m.winner === t ? "ring-4 ring-ball" : ""}`}
      >
        <span className="text-sm font-bold uppercase tracking-wide opacity-70">Team {t}{serving ? ` · serving (${m.server})` : ""}</span>
        <span className="mt-1 font-display text-xl font-bold md:text-2xl">{names.join(" & ")}</span>
        <span className="font-display text-8xl font-extrabold leading-none md:text-9xl">{score}</span>
        {!m.winner && <span className="mt-2 text-sm font-bold opacity-80">Tap if Team {t} won the rally</span>}
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-white">
        <p className="font-display text-lg">Game to {m.target} · win by 2</p>
        <p className="rounded-xl bg-white/10 px-3 py-1 font-display text-3xl font-extrabold tracking-wider" aria-live="polite">
          {m.winner ? "GAME" : m.call}
        </p>
      </div>

      {m.switchSides && <p className="mb-3 rounded-xl bg-pool px-4 py-2 text-center font-bold text-white">Switch sides now</p>}
      {m.gamePoint && <p className="mb-3 rounded-xl bg-white px-4 py-2 text-center font-bold text-court">Game point</p>}

      <div className="grid grid-cols-2 gap-3">
        {courtOrder(m.switched).map((t) => <div key={t} className="contents">{team(t)}</div>)}
      </div>
      {m.switched && !m.winner && <p className="mt-2 text-center text-xs text-white/60">Teams have switched ends.</p>}

      {m.winner && (
        <div className="mt-4 rounded-3xl bg-white p-5 text-center text-ink">
          <p className="font-display text-2xl font-extrabold">
            {(m.winner === "A" ? m.teamA : m.teamB).join(" & ")} win {Math.max(m.scoreA, m.scoreB)}–{Math.min(m.scoreA, m.scoreB)}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={pending} onClick={() => go(() => refConfirmAction(token, m.id, true))}
              className="rounded-xl bg-court px-4 py-3 font-bold text-white disabled:opacity-60">
              {m.openPlay ? "Save result → next 4" : "Save result"}
            </button>
            <button type="button" disabled={pending} onClick={() => go(() => refUndoAction(token, m.id))}
              className="rounded-xl border border-line px-4 py-3 font-bold disabled:opacity-60">
              Undo last point
            </button>
          </div>
        </div>
      )}

      {!m.winner && (
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" disabled={pending || !m.canUndo} onClick={() => go(() => refUndoAction(token, m.id))}
            className="rounded-xl bg-white px-5 py-3 font-bold text-ink disabled:opacity-40">
            ↶ Undo
          </button>
          <button type="button" disabled={pending}
            onClick={() => { if (window.confirm("Cancel this match without saving a result?")) go(() => refAbandonAction(token, m.id)); }}
            className="rounded-xl border border-white/40 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">
            Cancel match
          </button>
        </div>
      )}

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-4 py-2 text-sm ${msg.ok ? "bg-white text-court" : "bg-red-50 text-red-800"}`}>
          {msg.ok ? msg.message : msg.error}
        </p>
      )}
      <p className="mt-6 text-center text-xs text-white/60">Only the serving team can score. Losing the rally passes the serve: server 1 → server 2 → other team.</p>
    </div>
  );
}
