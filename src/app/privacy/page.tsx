import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy notice" };

// Owner: review this with your own details before going live. It is a starting template,
// not legal advice, written with the Data Privacy Act of 2012 (RA 10173) in mind.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-8 leading-relaxed">
      <Link href="/" className="font-display text-lg font-semibold text-court">Luther PaddlePoint &amp; Pool</Link>
      <h1 className="mt-6 font-display text-3xl font-extrabold">Privacy notice</h1>

      <h2 className="mt-6 font-display text-xl font-semibold">What we collect</h2>
      <p className="mt-2">
        Your name, mobile number, email address, the number of players or guests, and your GCash payment
        reference number and payment screenshot.
      </p>

      <h2 className="mt-6 font-display text-xl font-semibold">Why</h2>
      <p className="mt-2">
        To reserve your slot, verify your payment, send your confirmation and reminders, check you in, and
        keep basic records of our income. We don’t sell your information or use it for advertising.
      </p>

      <h2 className="mt-6 font-display text-xl font-semibold">Who can see it</h2>
      <p className="mt-2">
        Only the owner and our staff, through a password-protected dashboard. Our service providers (website
        hosting, database, email, and payment processing) handle it only to run this booking system.
      </p>

      <h2 className="mt-6 font-display text-xl font-semibold">How long we keep it</h2>
      <p className="mt-2">
        Booking records are kept for [1 year] after your booking date. Payment screenshots are deleted
        [90 days] after your booking date.
      </p>

      <h2 className="mt-6 font-display text-xl font-semibold">Your rights</h2>
      <p className="mt-2">
        Under the Data Privacy Act of 2012, you can ask to see, correct, or delete your information. Contact
        us at [email or mobile number].
      </p>
    </main>
  );
}
