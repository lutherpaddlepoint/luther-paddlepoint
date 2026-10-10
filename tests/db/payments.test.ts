// GCash payments: manual proofs, staff approval, late payments, and PayMongo webhooks.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createHold } from "../../src/lib/bookings";
import { confirmPayment, rejectPayment, submitManualProof, PaymentError, SLOT_TAKEN_NOTE } from "../../src/lib/payments";
import { POST as paymongoWebhook } from "../../src/app/api/webhooks/paymongo/route";
import {
  prisma, resetDb, courtInput, poolInput, PNG, uniqueGcashRef, bookingByRef, expireHold, fetchCalls,
  poolReserved, fulfilled, type Fx,
} from "./helpers";

let fx: Fx;
beforeEach(async () => { fx = await resetDb(); });
after(() => prisma.$disconnect());

const pay = (h: { referenceCode: string; accessToken: string }, gcashReference = uniqueGcashRef()) =>
  submitManualProof({ referenceCode: h.referenceCode, token: h.accessToken, gcashReference, image: PNG });

const pendingPaymentId = async (ref: string) => {
  const b = await bookingByRef(ref);
  const p = b.payments.find((x) => x.status === "PENDING");
  assert.ok(p, "expected a pending payment");
  return p.id;
};

test("happy path: proof → waiting for staff → approved → confirmed", async () => {
  const h = await createHold(courtInput(fx, 16, 18, "A"));
  assert.equal(await pay(h), "SUBMITTED");
  let b = await bookingByRef(h.referenceCode);
  assert.equal(b.status, "PENDING_VERIFICATION");
  assert.equal(b.holdExpiresAt, null);
  assert.equal(b.payments[0].amountCentavos, 225_00); // 50% of ₱450
  assert.ok(fetchCalls.some((c) => c.method === "POST" && c.url.includes("/storage/v1/object/")), "screenshot uploaded");

  // Waiting for staff never expires, even long after the hold time
  await prisma.booking.update({ where: { id: b.id }, data: { updatedAt: new Date(Date.now() - 86_400_000) } });
  await prisma.$queryRaw`SELECT expire_stale_holds()`;
  assert.equal((await bookingByRef(h.referenceCode)).status, "PENDING_VERIFICATION");

  assert.equal(await confirmPayment(await pendingPaymentId(h.referenceCode), { userId: fx.staff.id, source: "STAFF" }), "CONFIRMED");
  b = await bookingByRef(h.referenceCode);
  assert.equal(b.status, "CONFIRMED");
  assert.equal(b.payments[0].status, "PAID");
  assert.equal(b.payments[0].verifiedById, fx.staff.id);
});

test("two staff approve the same payment at once: confirmed once, one confirmation message", async () => {
  const h = await createHold(courtInput(fx, 8, 9, "A"));
  await pay(h);
  const id = await pendingPaymentId(h.referenceCode);
  const results = await Promise.allSettled([
    confirmPayment(id, { userId: fx.staff.id, source: "STAFF" }),
    confirmPayment(id, { userId: fx.owner.id, source: "STAFF" }),
  ]);
  const outcomes = fulfilled(results).map((r) => r.value).sort();
  assert.deepEqual(outcomes, ["ALREADY_PAID", "CONFIRMED"]);
  const b = await bookingByRef(h.referenceCode);
  assert.equal(b.notifications.filter((n) => n.event === "BOOKING_CONFIRMED" && n.channel === "EMAIL").length, 1);
});

test("the same GCash Ref. No. can't be used for two bookings; the second screenshot is deleted", async () => {
  const ref = uniqueGcashRef();
  const a = await createHold(courtInput(fx, 8, 9, "A"));
  const b = await createHold(courtInput(fx, 9, 10, "B"));
  await pay(a, ref);
  await assert.rejects(pay(b, ref), (e: unknown) => e instanceof PaymentError && e.status === 409);
  assert.ok(fetchCalls.some((c) => c.method === "DELETE"), "orphan screenshot removed");
  assert.equal((await bookingByRef(b.referenceCode)).status, "HOLD");
});

test("wrong private link is treated as not found", async () => {
  const h = await createHold(courtInput(fx, 8, 9, "A"));
  await assert.rejects(
    submitManualProof({ referenceCode: h.referenceCode, token: "wrong-token", gcashReference: uniqueGcashRef(), image: PNG }),
    (e: unknown) => e instanceof PaymentError && e.status === 404,
  );
});

test("non-image files are refused", async () => {
  const h = await createHold(courtInput(fx, 8, 9, "A"));
  await assert.rejects(
    submitManualProof({ referenceCode: h.referenceCode, token: h.accessToken, gcashReference: uniqueGcashRef(), image: new TextEncoder().encode("%PDF-1.7 fake") }),
    /JPG, PNG or WEBP/,
  );
});

test("paid late, slot still free: booking is restored", async () => {
  const h = await createHold(courtInput(fx, 20, 21, "A"));
  await expireHold(h.referenceCode);
  assert.equal((await bookingByRef(h.referenceCode)).status, "EXPIRED");
  assert.equal(await pay(h), "SUBMITTED_AFTER_EXPIRY");
  assert.equal((await bookingByRef(h.referenceCode)).status, "PENDING_VERIFICATION");
});

test("paid late, court slot taken by someone else: payment kept, booking flagged, other customer untouched", async () => {
  const a = await createHold(courtInput(fx, 20, 21, "A"));
  await expireHold(a.referenceCode);
  const b = await createHold(courtInput(fx, 20, 21, "B"));

  assert.equal(await pay(a), "SLOT_TAKEN");
  const ba = await bookingByRef(a.referenceCode);
  assert.equal(ba.status, "EXPIRED");
  assert.equal(ba.attentionReason, SLOT_TAKEN_NOTE);
  assert.equal(ba.payments.length, 1, "payment proof is on record");
  assert.equal((await bookingByRef(b.referenceCode)).status, "HOLD");

  // Staff approve it anyway (money did arrive): still flagged, B still safe
  assert.equal(await confirmPayment(ba.payments[0].id, { userId: fx.staff.id, source: "STAFF" }), "PAID_SLOT_TAKEN");
  assert.equal((await bookingByRef(a.referenceCode)).payments[0].status, "PAID");
  assert.equal((await bookingByRef(b.referenceCode)).status, "HOLD");
});

test("paid late, pool filled up meanwhile: flagged, pool stays at its limit", async () => {
  const a = await createHold(poolInput(fx, fx.daySessionId, 4, 0, "A"));
  await expireHold(a.referenceCode);
  for (let i = 0; i < 7; i++) await createHold(poolInput(fx, fx.daySessionId, 4, 0, `F${i}`)); // 28 of 30
  assert.equal(await pay(a), "SLOT_TAKEN");
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 28);
});

test("rejecting a proof frees the slot and tells the customer why", async () => {
  const h = await createHold(courtInput(fx, 8, 9, "A"));
  await pay(h);
  await rejectPayment(await pendingPaymentId(h.referenceCode), fx.staff.id, "Payment not received in GCash");
  const b = await bookingByRef(h.referenceCode);
  assert.equal(b.status, "REJECTED");
  const msg = b.notifications.find((n) => n.event === "PAYMENT_REJECTED" && n.channel === "EMAIL");
  assert.ok(msg);
  assert.equal((msg.payload as { reason?: string }).reason, "Payment not received in GCash");
  await createHold(courtInput(fx, 8, 9, "B")); // slot is free again
});

test("rejecting a pool proof gives the spots back", async () => {
  const h = await createHold(poolInput(fx, fx.daySessionId, 5, 1, "A"));
  await pay(h);
  await rejectPayment(await pendingPaymentId(h.referenceCode), fx.staff.id, "Wrong amount");
  assert.equal(await poolReserved(fx.daySessionId, fx.tomorrow), 0);
});

// ---------------------------------------------------------------- PayMongo webhook
async function paymongoSetup(amount?: number) {
  const h = await createHold(courtInput(fx, 10, 11, "A"));
  const b = await bookingByRef(h.referenceCode);
  await prisma.payment.create({
    data: { bookingId: b.id, type: "RESERVATION_FEE", method: "GCASH_PAYMONGO", amountCentavos: b.reservationFeeCentavos, providerPaymentId: "cs_test_123", status: "PENDING" },
  });
  const body = JSON.stringify({
    data: {
      id: "evt_1",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: { id: "cs_test_123", attributes: { payments: [{ id: "pay_1", attributes: { amount: amount ?? b.reservationFeeCentavos, status: "paid" } }] } },
      },
    },
  });
  return { h, body };
}

const signed = (body: string, secret = process.env.PAYMONGO_WEBHOOK_SECRET!) => {
  const t = "1760000000";
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return new Request("http://localhost/api/webhooks/paymongo", {
    method: "POST", body, headers: { "Content-Type": "application/json", "paymongo-signature": `t=${t},te=${sig},li=` },
  });
};

test("PayMongo webhook confirms the booking; the same webhook arriving twice changes nothing", async () => {
  const { h, body } = await paymongoSetup();
  const [r1, r2] = await Promise.all([paymongoWebhook(signed(body)), paymongoWebhook(signed(body))]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const b = await bookingByRef(h.referenceCode);
  assert.equal(b.status, "CONFIRMED");
  assert.equal(b.payments.filter((p) => p.status === "PAID").length, 1);
  assert.equal(b.notifications.filter((n) => n.event === "BOOKING_CONFIRMED" && n.channel === "EMAIL").length, 1);
});

test("PayMongo webhook with a forged signature is refused", async () => {
  const { h, body } = await paymongoSetup();
  const res = await paymongoWebhook(signed(body, "not-the-secret"));
  assert.equal(res.status, 401);
  assert.equal((await bookingByRef(h.referenceCode)).status, "HOLD");
});

test("PayMongo amount that doesn't match the fee is flagged, not confirmed", async () => {
  const { h, body } = await paymongoSetup(1_00);
  const res = await paymongoWebhook(signed(body));
  assert.equal(res.status, 200);
  const b = await bookingByRef(h.referenceCode);
  assert.equal(b.status, "HOLD");
  assert.match(b.attentionReason ?? "", /does not match/);
});
