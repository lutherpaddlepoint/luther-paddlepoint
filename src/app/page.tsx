import BookingWizard from "@/components/BookingWizard";
import { FACILITY } from "@/lib/defaults";

export default function Home() {
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
      <BookingWizard />
    </main>
  );
}
