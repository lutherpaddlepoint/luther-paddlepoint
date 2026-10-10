import { requireUser } from "@/lib/auth";
import CheckInFinder from "@/components/admin/CheckInFinder";
import { findBookingAction } from "@/app/admin/actions";

export default async function CheckInPage() {
  await requireUser();
  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold">Check-in</h1>
      <p className="mt-1 mb-6 max-w-md text-muted">Scan the QR code on the customer’s confirmation, or type their reference code. You’ll see the booking, the balance to collect, and the check-in button.</p>
      <CheckInFinder find={findBookingAction} />
    </div>
  );
}
