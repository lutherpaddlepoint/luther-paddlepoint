import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getRatesForm } from "@/lib/settings-admin";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import HourSelect from "@/components/admin/HourSelect";
import { addStaffAction, resetPasswordAction, saveGeneralAction, saveRatesAction, sendTestEmailAction, setActiveAction } from "@/app/admin/actions";
import { smsConfigured } from "@/lib/senders";

const pesoInput = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");

export default async function SettingsPage() {
  const me = await requireUser(["OWNER"]);
  const [rates, s, users] = await Promise.all([
    getRatesForm(),
    getSettings(),
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-2xl font-extrabold">Rates and hours</h1>
        <p className="mt-1 text-muted">Changes apply to new bookings. Existing bookings keep the price they were booked at.</p>
        <ActionForm action={saveRatesAction} submitLabel="Save rates and hours" confirm="Save the new rates and hours?"
          className="mt-4 grid gap-4 rounded-2xl border border-line bg-white p-5">
          <div className="grid grid-cols-3 gap-2">
            <label className={labelCls}>Opens<HourSelect name="open" from={0} to={1380} defaultMinute={rates.openMinute} className={inputCls} /></label>
            <label className={labelCls}>Night rate from<HourSelect name="nightStart" from={0} to={1380} defaultMinute={rates.nightStartMinute} className={inputCls} /></label>
            <label className={labelCls}>Closes<HourSelect name="close" from={60} to={1440} defaultMinute={rates.closeMinute} className={inputCls} /></label>
          </div>
          {rates.courts.map((c) => (
            <fieldset key={c.id} className="grid gap-2 rounded-xl border border-line p-3">
              <input type="hidden" name="courtId" value={c.id} />
              <label className={labelCls}>Court name<input name={`courtName_${c.id}`} defaultValue={c.name} maxLength={40} className={inputCls} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelCls}>Day rate (₱/hour)<input name={`courtDay_${c.id}`} inputMode="decimal" defaultValue={pesoInput(c.dayCentavos)} className={inputCls} /></label>
                <label className={labelCls}>Night rate (₱/hour)<input name={`courtNight_${c.id}`} inputMode="decimal" defaultValue={pesoInput(c.nightCentavos)} className={inputCls} /></label>
              </div>
            </fieldset>
          ))}
          <div className="grid grid-cols-3 gap-2">
            <label className={labelCls}>Pool adult (₱)<input name="poolAdult" inputMode="decimal" defaultValue={pesoInput(rates.poolAdultCentavos)} className={inputCls} /></label>
            <label className={labelCls}>Pool kid (₱)<input name="poolKid" inputMode="decimal" defaultValue={pesoInput(rates.poolKidCentavos)} className={inputCls} /></label>
            <label className={labelCls}>Pool max guests<input name="poolCapacity" type="number" min={1} defaultValue={rates.poolCapacity} className={inputCls} /></label>
          </div>
          <p className="text-sm text-muted">Pool day session runs from opening to the night-rate time; night session from then to closing.</p>
        </ActionForm>

        <h2 className="mt-10 font-display text-2xl font-extrabold">Booking and payment</h2>
        <ActionForm action={saveGeneralAction} submitLabel="Save settings" className="mt-4 grid gap-4 rounded-2xl border border-line bg-white p-5">
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Reservation fee (%)<input name="feePercent" type="number" min={1} max={100} defaultValue={s.reservation_fee_percent} className={inputCls} /></label>
            <label className={labelCls}>Hold time to pay (minutes)<input name="holdMinutes" type="number" min={10} max={180} defaultValue={s.hold_minutes.GCASH_MANUAL} className={inputCls} /></label>
            <label className={labelCls}>Book up to (days ahead)<input name="windowDays" type="number" min={1} max={365} defaultValue={s.booking_window_days} className={inputCls} /></label>
            <label className={labelCls}>Reschedule notice (hours)<input name="rescheduleHours" type="number" min={0} max={168} defaultValue={s.reschedule_policy.minHoursBefore} className={inputCls} /></label>
          </div>
          <label className={labelCls}>Payment method
            <select name="paymentMode" defaultValue={s.payment_mode} className={inputCls}>
              <option value="GCASH_MANUAL">Manual GCash (staff check each payment)</option>
              <option value="GCASH_PAYMONGO">PayMongo GCash (automatic; needs PayMongo account)</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>GCash account name<input name="gcashName" defaultValue={s.gcash_account.name} className={inputCls} /></label>
            <label className={labelCls}>GCash number<input name="gcashNumber" defaultValue={s.gcash_account.number} className={inputCls} /></label>
          </div>
          <label className={labelCls}>GCash QR image
            <input name="gcashQrPath" defaultValue={s.gcash_account.qrImagePath ?? ""} placeholder="/gcash-qr.png" className={inputCls} />
            <span className="mt-1 block font-normal text-muted">Put the image file in the website’s <code>public</code> folder, then type its name here.</span>
          </label>
          <label className={labelCls}>Booking policy shown to customers
            <textarea name="policyText" rows={4} defaultValue={s.policy_text} className={inputCls} />
          </label>
          <label className={labelCls}>How customers can contact you (shown in emails)
            <input name="contactInfo" defaultValue={s.contact_info} placeholder="0917 123 4567 or facebook.com/yourpage" className={inputCls} />
          </label>
          <label className={labelCls}>Send staff alerts to (emails, separated by commas)
            <input name="staffEmails" defaultValue={s.notifications.staffEmails.join(", ")} placeholder="owner@gmail.com, staff1@gmail.com" className={inputCls} />
            <span className="mt-1 block font-normal text-muted">They get an email for each GCash payment to check, and for bookings that need attention.</span>
          </label>
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-bold">Text messages (SMS) to customers</legend>
            {!smsConfigured() && <p className="mb-2 text-sm text-muted">SMS is off: no Semaphore key on the server. Emails still go out.</p>}
            {[
              ["BOOKING_CONFIRMED", "Booking confirmed"],
              ["REMINDER", "Reminder before the booking"],
              ["RESCHEDULED", "Booking moved"],
              ["PAYMENT_REJECTED", "Payment not accepted"],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 py-0.5 text-sm">
                <input type="checkbox" name="smsEvents" value={value} defaultChecked={s.notifications.smsEvents.includes(value)} className="h-4 w-4 accent-court" />
                {label}
              </label>
            ))}
            <p className="mt-1 text-xs text-muted">Each SMS costs about ₱0.50 with Semaphore. Confirmations and reminders include a link to the QR code, so they use 2 SMS (about ₱1).</p>
          </fieldset>
        </ActionForm>

        <h2 className="mt-10 font-display text-2xl font-extrabold">Test email</h2>
        <ActionForm action={sendTestEmailAction} submitLabel="Send test email" tone="plain" pendingLabel="Sending…" className="mt-4 rounded-2xl border border-line bg-white p-5">
          <label className={labelCls}>Send to<input name="to" type="email" defaultValue={me.email.endsWith(".local") ? "" : me.email} placeholder="your@gmail.com" className={inputCls} /></label>
        </ActionForm>
      </section>

      <section>
        <h2 className="font-display text-2xl font-extrabold">Staff accounts</h2>
        <ul className="mt-4 grid gap-3">
          {users.map((u) => (
            <li key={u.id} className={`rounded-2xl border border-line bg-white p-4 ${u.isActive ? "" : "opacity-60"}`}>
              <p className="font-bold">{u.name} <span className="font-normal text-muted">({u.role === "OWNER" ? "owner" : "staff"}{u.isActive ? "" : ", deactivated"})</span></p>
              <p className="text-sm text-muted">{u.email}</p>
              {u.id !== me.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={resetPasswordAction} submitLabel="Reset password" tone="plain" confirm={`Reset ${u.name}'s password? They'll be logged out.`}>
                    <input type="hidden" name="userId" value={u.id} />
                  </ActionForm>
                  <ActionForm action={setActiveAction} submitLabel={u.isActive ? "Deactivate" : "Reactivate"} tone="plain"
                    confirm={u.isActive ? `Deactivate ${u.name}? They won't be able to log in.` : undefined}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={u.isActive ? "0" : "1"} />
                  </ActionForm>
                </div>
              )}
            </li>
          ))}
        </ul>

        <h3 className="mt-6 font-display text-xl font-semibold">Add staff</h3>
        <ActionForm action={addStaffAction} submitLabel="Create account" className="mt-3 grid gap-3 rounded-2xl border border-line bg-white p-5" resetOnSuccess>
          <label className={labelCls}>Name<input name="name" className={inputCls} required /></label>
          <label className={labelCls}>Email (used to log in)<input name="email" type="email" className={inputCls} required /></label>
        </ActionForm>
        <p className="mt-2 text-sm text-muted">A temporary password is shown once. Ask them to change it under “My account”.</p>
      </section>
    </div>
  );
}
