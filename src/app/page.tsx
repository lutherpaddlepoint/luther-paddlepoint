import BookingWizard from "@/components/BookingWizard";
import Link from "next/link";
import Image from "next/image";
import { FACILITY } from "@/lib/defaults";
import { upcomingPublicSessions, sessionLabel } from "@/lib/open-play";

export const revalidate = 60;

// Exact map pin. To move it: right-click the spot in Google Maps and copy the numbers.
const PIN = "6.625928,124.062926";
const GOOGLE_MAPS = `https://www.google.com/maps/dir/?api=1&destination=${PIN}`;
const WAZE = `https://waze.com/ul?ll=${PIN}&navigate=yes`;
const MAP_EMBED = `https://maps.google.com/maps?q=${PIN}&z=17&output=embed`;

function DirectionsButtons({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a href={GOOGLE_MAPS} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-court px-4 py-2.5 text-sm font-bold text-white">
        📍 Google Maps
      </a>
      <a href={WAZE} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#33CCFF] px-4 py-2.5 text-sm font-bold text-ink">
        🚗 Waze
      </a>
    </div>
  );
}

export default async function Home() {
  const openPlay = await upcomingPublicSessions(1).catch(() => []);
  return (
    <main className="mx-auto max-w-xl px-5 pt-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-pool">
          <Image src="/logo-banner.png" alt="Luther PaddlePoint" width={1085} height={350} priority className="h-auto w-full max-w-md rounded-2xl" />
          <span className="mt-2 block">&amp; Pool</span>
        </h1>
        <p className="mt-3 text-muted">{FACILITY.address}</p>
        <DirectionsButtons className="mt-3" />
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
      <section className="mb-36 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-xl font-semibold">How to get here</h2>
        <p className="mt-1 text-sm text-muted">{FACILITY.address}</p>
        <iframe src={MAP_EMBED} title="Map to Luther PaddlePoint & Pool" loading="lazy" className="mt-4 h-64 w-full rounded-xl border-0 bg-paper" />
        <DirectionsButtons className="mt-4" />
      </section>
    </main>
  );
}
