import BookingWizard from "@/components/BookingWizard";
import Link from "next/link";
import { FACILITY } from "@/lib/defaults";
import { upcomingPublicSessions, sessionLabel } from "@/lib/open-play";

export const revalidate = 60;

export default async function Home() {
  const openPlay = await upcomingPublicSessions(1).catch(() => []);
  return (
    <main className="mx-auto max-w-xl px-5 pt-8">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-court">
          Luther PaddlePoint
          <span className="block text-pool">&amp; Pool</span>
        </h1>
        <p className="mt-3 text-muted">{FACILITY.address}</p>
        <p className="mt-4 max-w-md text-lg">
          Pick your time, see the price, and hold your slot with a GCash reservation fee.
        </p>
      </header>
      {openPlay[0] && (
        <Link href="/open-play" className="mb-6 block rounded-2xl border border-court/30 bg-court/5 px-4 py-3">
          <span className="block text-sm font-bold text-court">Open play, walk in</span>
          <span className="block">{sessionLabel(openPlay[0])}</span>
          <span className="text-sm text-muted">See the schedule and the paddle stack →</span>
        </Link>
      )}
      <BookingWizard />
    </main>
  );
}
