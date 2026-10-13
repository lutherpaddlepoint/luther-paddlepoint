import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, renderSms, esc, SMS_MAX, type MessageView, type MessageEvent } from "../src/lib/templates";

const v: MessageView = {
  facilityName: "Luther PaddlePoint & Pool", address: "Necesito Place, Poblacion 3, Lebak, Sultan Kudarat",
  contact: "0917 123 4567", ref: "LPP-7K3QX", amenityName: "Pickleball Court 1", dateLabel: "Monday, October 12",
  shortDate: "Oct 12", timeLabel: "4:00 PM to 6:00 PM", startLabel: "4:00 PM", guestsLabel: "4 players",
  customerName: "Juan <b>Dela Cruz</b>", totalLabel: "₱450.00", paidLabel: "₱225.00", balanceLabel: "₱225.00",
  balanceCentavos: 225_00, bookingUrl: "https://x.vercel.app/booking/LPP-7K3QX?t=abc", adminUrl: "https://x.vercel.app/admin/payments",
  policyText: "The reservation fee is non-refundable.", hasQr: true,
};
const ALL: MessageEvent[] = ["PROOF_RECEIVED", "BOOKING_CONFIRMED", "PAYMENT_REJECTED", "REMINDER", "CANCELLED", "RESCHEDULED", "STAFF_PROOF_RECEIVED", "STAFF_NEEDS_ATTENTION"];

test("every email has subject, text and html, with the reference code", () => {
  for (const e of ALL) {
    const m = renderEmail(e, v);
    assert.ok(m.subject.includes("LPP-7K3QX"), e);
    assert.ok(m.text.length > 20 && m.html.includes("<html>"), e);
  }
});

test("customer names can't inject HTML into emails", () => {
  const html = renderEmail("BOOKING_CONFIRMED", v).html;
  assert.ok(!html.includes("<b>Dela Cruz</b>"));
  assert.ok(html.includes("&lt;b&gt;Dela Cruz&lt;/b&gt;"));
  assert.equal(esc(`"'&`), "&quot;&#39;&amp;");
});

test("confirmation includes QR image, balance and booking link", () => {
  const m = renderEmail("BOOKING_CONFIRMED", v);
  assert.ok(m.html.includes('src="cid:qr"'));
  assert.ok(m.html.includes("₱225.00"));
  assert.ok(m.html.includes("https://x.vercel.app/booking/LPP-7K3QX?t=abc"));
  assert.ok(!renderEmail("BOOKING_CONFIRMED", { ...v, hasQr: false }).html.includes("cid:qr"));
});

test("reminder mentions balance only when there is one", () => {
  assert.ok(renderEmail("REMINDER", v).text.includes("bring ₱225.00"));
  assert.ok(!renderEmail("REMINDER", { ...v, balanceCentavos: 0 }).text.includes("bring"));
});

test("SMS: plain ASCII, at most 2 parts, only for chosen events", () => {
  for (const e of ALL) {
    const s = renderSms(e, v);
    if (s === null) continue;
    assert.ok(s.length <= SMS_MAX, `${e}: ${s.length}`);
    assert.match(s, /^[\x20-\x7E]+$/, e);
  }
  assert.equal(
    renderSms("BOOKING_CONFIRMED", v),
    "Luther PaddlePoint: CONFIRMED LPP-7K3QX, Court 1 Oct 12 4PM-6PM. Balance P225 on-site. Show QR or ref at counter. QR: https://x.vercel.app/booking/LPP-7K3QX?t=abc",
  );
  assert.ok(renderSms("REMINDER", v)!.endsWith("QR: https://x.vercel.app/booking/LPP-7K3QX?t=abc"));
  assert.ok(renderSms("PAYMENT_REJECTED", v)!.length <= 160);
  assert.ok(!renderSms("PAYMENT_REJECTED", v)!.includes("http"));
  assert.ok(renderSms("BOOKING_CONFIRMED", { ...v, amenityName: "Swimming pool" })!.includes(", Pool Oct 12"));
  assert.equal(renderSms("PROOF_RECEIVED", v), null);
  assert.equal(renderSms("STAFF_PROOF_RECEIVED", v), null);
});

test("SMS: a long message is shortened but the link is never cut", () => {
  const long = { ...v, facilityName: "X".repeat(400) };
  const s = renderSms("BOOKING_CONFIRMED", long)!;
  assert.ok(s.length <= SMS_MAX);
  assert.ok(s.endsWith(" QR: https://x.vercel.app/booking/LPP-7K3QX?t=abc"));
});
