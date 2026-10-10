import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold">Page not found</h1>
      <p className="mt-3 text-muted">
        If you’re looking for a booking, open the exact link from your booking page or confirmation email.
      </p>
      <Link href="/" className="mt-6 inline-block rounded-xl bg-court px-5 py-3 font-bold text-white">Book a slot</Link>
    </main>
  );
}
