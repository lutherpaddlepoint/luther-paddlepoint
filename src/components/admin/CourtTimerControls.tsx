import ActionForm from "@/components/admin/ActionForm";
import { extendCourtTimerAction, startCourtTimerAction, stopCourtTimerAction } from "@/app/admin/actions";
import type { CourtTimer } from "@/lib/court-timer";

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Staff controls for the TV countdown. With `bookingId`, offers to start it for that booking;
 * when a timer is running, offers +10 / +30 minutes and Stop.
 */
export default function CourtTimerControls({ timer, bookingId, courtId, courtName, courtNumber }: {
  timer: CourtTimer | null; bookingId?: string; courtId: string; courtName?: string; courtNumber?: number;
}) {
  const runningHere = !!timer && (!bookingId || timer.bookingId === bookingId);
  const tv = courtNumber ? `/score?court=${courtNumber}` : "/score";
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{courtName ? `${courtName} countdown (TV)` : "Court countdown (TV)"}</h2>
        <a href={tv} target="_blank" rel="noreferrer" className="text-sm font-bold text-court underline">Open TV screen ↗</a>
      </div>
      {runningHere ? (
        <>
          <p className="mt-1">
            Running: <b>{timer!.label.split(" · ")[0]}</b>, time&rsquo;s up at <b>{time(timer!.endsAt)}</b>.
            {Date.parse(timer!.endsAt) <= Date.now() && <span className="ml-1 font-bold text-red-700">Time is up.</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 [&_button]:mt-0">
            {[10, 30, 60].map((m) => (
              <ActionForm key={m} action={extendCourtTimerAction} submitLabel={`+${m} min`} tone="plain">
                <input type="hidden" name="courtId" value={courtId} />
                <input type="hidden" name="minutes" value={m} />
              </ActionForm>
            ))}
            <ActionForm action={stopCourtTimerAction} submitLabel="Stop countdown" tone="plain" confirm="Stop the countdown on the TV?">
              <input type="hidden" name="courtId" value={courtId} />
            </ActionForm>
          </div>
        </>
      ) : bookingId ? (
        <>
          <p className="mt-1 text-sm text-muted">
            Shows a big countdown to the end of this booking on the TV, beeps at 5 minutes left, and sounds an alarm when time is up.
            {timer && " This replaces the countdown that is running now."}
          </p>
          <ActionForm action={startCourtTimerAction} submitLabel="Start countdown on TV" full>
            <input type="hidden" name="bookingId" value={bookingId} />
          </ActionForm>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">No countdown running. Start one from a court booking (Today or Calendar → the booking → Start countdown on TV).</p>
      )}
    </section>
  );
}
