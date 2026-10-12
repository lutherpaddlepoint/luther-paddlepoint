import type { Metadata } from "next";
import { isValidRefereeToken, liveMatch, matchView } from "@/lib/scoring";
import { currentPublicSession, openPlayBoard } from "@/lib/open-play";
import { TARGETS } from "@/lib/scoring-core";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import RefereePad from "@/components/score/RefereePad";
import AutoRefresh from "@/components/AutoRefresh";
import { refStartOpenPlayAction, refStartQuickAction } from "@/app/ref/actions";

export const metadata: Metadata = { title: "Referee", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function TargetSelect() {
  return (
    <label className={labelCls}>Game to
      <select name="target" defaultValue="11" className={inputCls}>
        {TARGETS.map((t) => <option key={t} value={t}>{t} points (win by 2)</option>)}
      </select>
    </label>
  );
}

export default async function RefereePage({ params }: { params: { token: string } }) {
  if (!(await isValidRefereeToken(params.token))) {
    return (
      <main className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="font-display text-2xl font-extrabold">Referee link not valid</h1>
        <p className="mt-2 text-muted">Ask the staff for the current referee link or QR code.</p>
      </main>
    );
  }

  const live = await liveMatch();
  if (live) {
    return (
      <main className="min-h-screen bg-court px-3 py-4">
        <RefereePad token={params.token} m={matchView(live)} />
      </main>
    );
  }

  const session = await currentPublicSession();
  const board = session ? await openPlayBoard(session.id) : null;
  const onCourt = board?.onCourt ?? [];
  const [p1, p2, p3, p4] = onCourt.map((p) => p.name);

  return (
    <main className="mx-auto max-w-xl px-5 py-6">
      {/* Picks up the next open play game as soon as the staff puts 4 players on court. */}
      <AutoRefresh everyMs={10_000} maxTimes={1000} />
      <h1 className="font-display text-3xl font-extrabold text-court">Referee</h1>
      <p className="text-muted">Start a match, then tap the team that wins each rally. The score shows on the TV.</p>

      {board && (
        <section className="mt-6 rounded-2xl border-2 border-court bg-white p-5">
          <h2 className="font-display text-xl font-semibold">Open play game</h2>
          {onCourt.length === 4 ? (
            <ActionForm action={refStartOpenPlayAction} submitLabel="Start scoring" full className="mt-3 grid gap-3">
              <input type="hidden" name="token" value={params.token} />
              <input type="hidden" name="sessionId" value={board.session.id} />
              <fieldset className="grid gap-2">
                <legend className={labelCls}>Partners</legend>
                {[[`${p1} & ${p2}`, `${p3} & ${p4}`], [`${p1} & ${p3}`, `${p2} & ${p4}`], [`${p1} & ${p4}`, `${p2} & ${p3}`]].map(([a, b], i) => (
                  <label key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <input type="radio" name="pairing" value={i} defaultChecked={i === 0} />
                    <span><b>{a}</b> vs <b>{b}</b></span>
                  </label>
                ))}
              </fieldset>
              <TargetSelect />
              <p className="text-xs text-muted">The first team listed serves first (starts at 0-0-2).</p>
            </ActionForm>
          ) : (
            <p className="mt-2 text-muted">Waiting for the staff to put 4 players on court. This page updates by itself.</p>
          )}
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-xl font-semibold">Quick match</h2>
        <p className="text-sm text-muted">For court bookings or friendly games. Team A serves first.</p>
        <ActionForm action={refStartQuickAction} submitLabel="Start match" full className="mt-3 grid gap-3">
          <input type="hidden" name="token" value={params.token} />
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Team A, player 1<input name="a1" maxLength={30} className={inputCls} required autoComplete="off" /></label>
            <label className={labelCls}>Team A, player 2<input name="a2" maxLength={30} className={inputCls} required autoComplete="off" /></label>
            <label className={labelCls}>Team B, player 1<input name="b1" maxLength={30} className={inputCls} required autoComplete="off" /></label>
            <label className={labelCls}>Team B, player 2<input name="b2" maxLength={30} className={inputCls} required autoComplete="off" /></label>
          </div>
          <TargetSelect />
        </ActionForm>
      </section>
    </main>
  );
}
