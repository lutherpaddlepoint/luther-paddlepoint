"use server";

// Referee buttons. No login: each action checks the secret referee link instead.
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import {
  abandonMatch, confirmResult, recordRally, ScoreError, startOpenPlayMatch, startQuickMatch, undoRally,
} from "@/lib/scoring";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function run(token: string, fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  // Generous limit (a fast rally pace is ~1 tap every few seconds) but stops scripted abuse.
  if (!rateLimit(`ref:${token}`, 120, 60_000)) return { ok: false, error: "Too many taps. Wait a few seconds." };
  try {
    const r = await fn();
    revalidatePath("/ref", "layout");
    revalidatePath("/score");
    revalidatePath("/open-play");
    return r ?? { ok: true };
  } catch (e) {
    if (e instanceof ScoreError) return { ok: false, error: e.message };
    console.error("Referee action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function refRallyAction(token: string, matchId: string, team: "A" | "B") {
  return run(token, async () => { await recordRally(token, matchId, team); });
}

export async function refUndoAction(token: string, matchId: string) {
  return run(token, async () => { await undoRally(token, matchId); });
}

export async function refConfirmAction(token: string, matchId: string, nextFour: boolean) {
  return run(token, async () => {
    const r = await confirmResult(token, matchId, nextFour);
    return { ok: true, message: r.next ? `Saved. Next on court: ${r.next.join(", ")}` : "Result saved." };
  });
}

export async function refAbandonAction(token: string, matchId: string) {
  return run(token, async () => { await abandonMatch(token, matchId); });
}

export async function refStartOpenPlayAction(fd: FormData) {
  const token = str(fd, "token");
  return run(token, async () => {
    await startOpenPlayMatch(token, str(fd, "sessionId"), Number(str(fd, "pairing")), Number(str(fd, "target")));
  });
}

export async function refStartQuickAction(fd: FormData) {
  const token = str(fd, "token");
  return run(token, async () => {
    await startQuickMatch(token, [str(fd, "a1"), str(fd, "a2")], [str(fd, "b1"), str(fd, "b2")], Number(str(fd, "target")));
  });
}
