// Message wording for emails and SMS. Pure functions (no sending), so they're easy to test and edit.
import { shortCourtName } from "./courts-core";

export type MessageEvent =
  | "PROOF_RECEIVED" | "BOOKING_CONFIRMED" | "PAYMENT_REJECTED" | "REMINDER" | "CANCELLED" | "RESCHEDULED"
  | "STAFF_PROOF_RECEIVED" | "STAFF_NEEDS_ATTENTION";

export type MessageView = {
  facilityName: string;
  address: string;
  contact: string; // how customers reach you, e.g. "0917 123 4567 or facebook.com/..."
  ref: string;
  amenityName: string;
  dateLabel: string; // "Monday, October 12"
  shortDate: string; // "Oct 12"
  timeLabel: string; // "4:00 PM to 6:00 PM"
  startLabel: string; // "4:00 PM"
  guestsLabel: string; // "4 players" / "2 adults, 1 kid"
  customerName: string;
  totalLabel: string;
  paidLabel: string;
  balanceLabel: string;
  balanceCentavos: number;
  bookingUrl: string;
  adminUrl: string;
  policyText: string;
  reason?: string; // rejection reason / attention reason
  amountLabel?: string; // payment amount for staff alerts
  hasQr: boolean; // an inline QR image is attached as cid:qr
};

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// SMS: plain ASCII keeps one message at 160 characters (₱ or curly quotes would cut it to 70).
const ascii = (s: string) =>
  s.replace(/₱/g, "P").replace(/[–—]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/ñ/g, "n").replace(/Ñ/g, "N")
    .replace(/[^\x20-\x7E]/g, "");
const smsPeso = (label: string) => label.replace(/\.00$/, "");
const smsTime = (t: string) => t.replace(/:00 /g, "").replace(/ to /, "-"); // "4:00 PM to 6:00 PM" -> "4PM-6PM"

function layout(v: MessageView, title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#F5F8F7;font-family:Arial,Helvetica,sans-serif;color:#13232B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #D2DEDB">
<tr><td style="background:#1D5A45;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${esc(v.facilityName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #D2DEDB;font-size:12px;color:#55676D">${esc(v.address)}<br>Questions: ${esc(v.contact)}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#1D5A45;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${esc(label)}</a></p>`;

function details(v: MessageView, withMoney = true) {
  const row = (k: string, val: string, strong = false) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#55676D;font-size:14px">${esc(k)}</td><td style="padding:4px 0;font-size:14px${strong ? ";font-weight:bold" : ""}">${esc(val)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px">
${row("Reference", v.ref, true)}${row("Booking", v.amenityName)}${row("Date", v.dateLabel)}${row("Time", v.timeLabel)}${row("Guests", v.guestsLabel)}
${withMoney ? row("Total", v.totalLabel) + row("Paid", v.paidLabel) + row("Balance, pay on-site", v.balanceLabel, true) : ""}
</table>`;
}

const qrBlock = (v: MessageView) =>
  v.hasQr
    ? `<div style="text-align:center;margin:16px 0;padding:16px;background:#F5F8F7;border-radius:12px"><img src="cid:qr" width="180" height="180" alt="QR code for ${esc(v.ref)}" style="display:block;margin:0 auto"><div style="margin-top:8px;font-size:20px;font-weight:bold;letter-spacing:2px">${esc(v.ref)}</div><div style="font-size:13px;color:#55676D">Show this at the counter</div></div>`
    : "";

const detailsText = (v: MessageView, withMoney = true) =>
  [`Reference: ${v.ref}`, `Booking: ${v.amenityName}`, `Date: ${v.dateLabel}`, `Time: ${v.timeLabel}`, `Guests: ${v.guestsLabel}`,
    ...(withMoney ? [`Total: ${v.totalLabel}`, `Paid: ${v.paidLabel}`, `Balance, pay on-site: ${v.balanceLabel}`] : [])].join("\n");

const footerText = (v: MessageView) => `\n\n${v.facilityName}\n${v.address}\nQuestions: ${v.contact}`;

export type Email = { subject: string; text: string; html: string };

export function renderEmail(event: MessageEvent, v: MessageView): Email {
  const hi = `Hi ${v.customerName},`;
  switch (event) {
    case "BOOKING_CONFIRMED":
      return {
        subject: `Confirmed: ${v.amenityName}, ${v.shortDate}, ${v.timeLabel} (${v.ref})`,
        text: `${hi}\n\nYou're booked! Show your reference code or QR code at the counter.\n\n${detailsText(v)}\n\n${v.policyText}\n\nView your booking: ${v.bookingUrl}${footerText(v)}`,
        html: layout(v, "You’re booked!", p(esc(hi)) + p("Show this QR code or your reference code at the counter.") + qrBlock(v) + details(v)
          + p(`<span style="color:#55676D;font-size:13px">${esc(v.policyText)}</span>`) + button(v.bookingUrl, "View your booking")),
      };
    case "RESCHEDULED":
      return {
        subject: `New time: ${v.amenityName}, ${v.shortDate}, ${v.timeLabel} (${v.ref})`,
        text: `${hi}\n\nYour booking has been moved. Here are the new details.\n\n${detailsText(v)}\n\nView your booking: ${v.bookingUrl}${footerText(v)}`,
        html: layout(v, "Your booking has a new time", p(esc(hi)) + p("Your booking has been moved. Here are the new details.") + qrBlock(v) + details(v) + button(v.bookingUrl, "View your booking")),
      };
    case "REMINDER":
      return {
        subject: `Reminder: ${v.amenityName} at ${v.startLabel} today (${v.ref})`,
        text: `${hi}\n\nSee you soon! Your booking starts at ${v.startLabel} today.${v.balanceCentavos > 0 ? ` Please bring ${v.balanceLabel} for the balance.` : ""}\n\n${detailsText(v)}${footerText(v)}`,
        html: layout(v, `See you at ${v.startLabel} today`, p(esc(hi))
          + (v.balanceCentavos > 0 ? p(`Please bring <strong>${esc(v.balanceLabel)}</strong> for the balance (cash or GCash).`) : "")
          + qrBlock(v) + details(v) + button(v.bookingUrl, "View your booking")),
      };
    case "PROOF_RECEIVED":
      return {
        subject: `Payment received, checking it now (${v.ref})`,
        text: `${hi}\n\nWe got your GCash payment proof. Our staff will check it and email you once your booking is confirmed. Your slot stays reserved while we check.\n\n${detailsText(v, false)}\n\nView your booking: ${v.bookingUrl}${footerText(v)}`,
        html: layout(v, "We got your payment proof", p(esc(hi)) + p("Our staff will check it and email you once your booking is confirmed. Your slot stays reserved while we check.")
          + details(v, false) + button(v.bookingUrl, "View your booking")),
      };
    case "PAYMENT_REJECTED":
      return {
        subject: `We couldn't confirm your payment (${v.ref})`,
        text: `${hi}\n\nWe couldn't confirm your GCash payment for booking ${v.ref}${v.reason ? `: ${v.reason}` : "."}\nThe slot has been released.\n\nIf you did send the payment, please contact us with your GCash receipt: ${v.contact}${footerText(v)}`,
        html: layout(v, "We couldn’t confirm your payment", p(esc(hi))
          + p(`We couldn’t confirm your GCash payment for booking <strong>${esc(v.ref)}</strong>${v.reason ? `: ${esc(v.reason)}` : "."} The slot has been released.`)
          + p(`If you did send the payment, please contact us with your GCash receipt: ${esc(v.contact)}`) + details(v, false)),
      };
    case "CANCELLED":
      return {
        subject: `Booking cancelled (${v.ref})`,
        text: `${hi}\n\nYour booking ${v.ref} has been cancelled. As stated in our policy, the reservation fee is non-refundable.\n\n${detailsText(v, false)}\n\nQuestions? ${v.contact}${footerText(v)}`,
        html: layout(v, "Your booking was cancelled", p(esc(hi))
          + p(`Your booking <strong>${esc(v.ref)}</strong> has been cancelled. As stated in our policy, the reservation fee is non-refundable.`) + details(v, false)),
      };
    case "STAFF_PROOF_RECEIVED":
      return {
        subject: `GCash payment to check: ${v.ref} ${v.amountLabel ?? ""}`.trim(),
        text: `${v.customerName} sent GCash proof for ${v.ref} (${v.amountLabel}).\n${v.amenityName}, ${v.dateLabel}, ${v.timeLabel}\n\nCheck it in your GCash app, then approve or reject: ${v.adminUrl}`,
        html: layout(v, "New GCash payment to check", p(`${esc(v.customerName)} sent GCash proof for <strong>${esc(v.ref)}</strong> (${esc(v.amountLabel ?? "")}).`)
          + details(v, false) + p("Check it in your GCash app, then approve or reject.") + button(v.adminUrl, "Open payments")),
      };
    case "STAFF_NEEDS_ATTENTION":
      return {
        subject: `Needs attention: ${v.ref}`,
        text: `${v.ref} (${v.customerName}) needs attention:\n${v.reason ?? ""}\n\n${detailsText(v, false)}\n\nOpen: ${v.adminUrl}`,
        html: layout(v, `Needs attention: ${v.ref}`, p(esc(v.reason ?? "")) + details(v, false) + button(v.adminUrl, "Open booking")),
      };
  }
}

/**
 * SMS text for customer events (null = no SMS for this event). Plain ASCII, one 160-character SMS.
 * No links: Smart blocks texts with links, so the QR code goes by email only.
 * Starts with the business name so telcos and customers know who sent it.
 */
export function renderSms(event: MessageEvent, v: MessageView): string | null {
  const name = ascii(v.facilityName).replace(/ & Pool$/, "");
  const when = `${v.shortDate} ${smsTime(v.timeLabel)}`;
  const bal = v.balanceCentavos > 0 ? ` Balance ${smsPeso(v.balanceLabel)} on-site.` : "";
  const what = v.amenityName.toLowerCase().includes("pool") ? "Pool" : shortCourtName(v.amenityName);
  let msg: string | null = null;
  if (event === "BOOKING_CONFIRMED") msg = `${name}: CONFIRMED ${v.ref}, ${what} ${when}.${bal} Show ref or emailed QR at counter.`;
  else if (event === "RESCHEDULED") msg = `${name}: ${v.ref} moved to ${what} ${when}.${bal}`;
  else if (event === "REMINDER") msg = `${name}: Reminder, ${what} today ${smsTime(v.timeLabel)}, ref ${v.ref}.${bal} See you!`;
  else if (event === "PAYMENT_REJECTED") msg = `${name}: Payment for ${v.ref} not confirmed, slot released. If you paid, contact us: ${v.contact}`;
  if (!msg) return null;
  const clean = ascii(msg);
  return clean.length <= 160 ? clean : clean.slice(0, 157) + "...";
}
