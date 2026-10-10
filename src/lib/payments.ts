// Payment flows shared by the customer page, the PayMongo webhook, the staff dashboard
// (Phase 5) and the staff command-line tool (scripts/payments.ts).

import { timingSafeEqual } from "node:crypto";
import { Prisma, type Booking } from "@prisma/client";
import { prisma } from "./db";
import { expireStaleHolds } from "./availability";
import { deleteProof, uploadProof } from "./storage";
import { detectImageType, MAX_PROOF_BYTES, normalizeGcashRef } from "./payment-core";
import { notify } from "./notify";

type Tx = Prisma.TransactionClient;

export class PaymentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Raised inside a transaction when an expired booking can't get its slot back. */
class SlotTakenError extends Error {}

const errText = (e: unknown) => String((e as Error)?.message ?? "");
const isOverlapError = (e: unknown) => errText(e).includes("bookings_no_overlap") || errText(e).includes("23P01");
const isDuplicateGcashRef = (e: unknown) => errText(e).includes("payments_gcash_reference_unique");

export const SLOT_TAKEN_NOTE =
  "Customer paid after their hold expired, and the slot was already taken. Contact them to rebook or settle.";

export function tokenMatches(booking: Pick<Booking, "accessToken">, token: string) {
  const a = Buffer.from(booking.accessToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function audit(tx: Tx, action: string, entityId: string, userId: string | null, details?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { action, entity: "booking", entityId, userId, details } });
}

/**
 * Brings an EXPIRED booking back to life if its slot is still free.
 * Court: the double-booking constraint throws if the time was taken (caller handles it).
 * Pool: spots are re-reserved; throws SlotTakenError if the session filled up.
 */
async function revive(tx: Tx, b: Booking, to: "PENDING_VERIFICATION" | "CONFIRMED") {
  if (b.poolInventoryId) {
    const [{ reserve_pool_spots: ok }] = await tx.$queryRaw<{ reserve_pool_spots: number | null }[]>`
      SELECT reserve_pool_spots(${b.poolInventoryId}::uuid, ${b.adults + b.kids}::int)`;
    if (ok === null) throw new SlotTakenError();
  }
  await tx.booking.update({ where: { id: b.id }, data: { status: to, holdExpiresAt: null } });
}

// ---------------------------------------------------------------------------
// 1. Customer submits manual GCash proof
// ---------------------------------------------------------------------------
export type ProofResult = "SUBMITTED" | "SUBMITTED_AFTER_EXPIRY" | "SLOT_TAKEN";

export async function submitManualProof(args: {
  referenceCode: string;
  token: string;
  gcashReference: string;
  image: Uint8Array;
}): Promise<ProofResult> {
  const gcashRef = normalizeGcashRef(args.gcashReference);
  if (!gcashRef) throw new PaymentError("Enter the Ref. No. from your GCash receipt (numbers only).");
  if (args.image.byteLength === 0) throw new PaymentError("Please attach your GCash receipt screenshot.");
  if (args.image.byteLength > MAX_PROOF_BYTES) throw new PaymentError("The screenshot is too large. Please use a smaller image.");
  const type = detectImageType(args.image);
  if (!type) throw new PaymentError("Please upload a JPG, PNG or WEBP screenshot.");

  await expireStaleHolds();
  const booking = await prisma.booking.findUnique({ where: { referenceCode: args.referenceCode }, include: { payments: true } });
  if (!booking || !tokenMatches(booking, args.token)) throw new PaymentError("Booking not found.", 404);

  const hasLivePayment = booking.payments.some((p) => p.type === "RESERVATION_FEE" && p.status !== "REJECTED");
  if (hasLivePayment) throw new PaymentError("We already have a payment for this booking.", 409);
  if (booking.status !== "HOLD" && booking.status !== "EXPIRED")
    throw new PaymentError("This booking is no longer waiting for payment.", 409);

  const path = `${booking.id}/${Date.now()}.${type.ext}`;
  await uploadProof(path, args.image, type.mime);

  const paymentData = {
    bookingId: booking.id,
    type: "RESERVATION_FEE" as const,
    method: "GCASH_MANUAL" as const,
    amountCentavos: booking.reservationFeeCentavos,
    gcashReference: gcashRef,
    proofImagePath: path,
    status: "PENDING" as const,
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      await tx.payment.create({ data: paymentData });

      if (current.status === "HOLD") {
        await tx.booking.update({ where: { id: current.id }, data: { status: "PENDING_VERIFICATION", holdExpiresAt: null } });
        await audit(tx, "PROOF_SUBMITTED", current.id, null, { gcashRef });
        return "SUBMITTED" as const;
      }
      if (current.status === "EXPIRED") {
        await revive(tx, current, "PENDING_VERIFICATION");
        await audit(tx, "PROOF_SUBMITTED_AFTER_EXPIRY", current.id, null, { gcashRef });
        return "SUBMITTED_AFTER_EXPIRY" as const;
      }
      throw new PaymentError("This booking is no longer waiting for payment.", 409);
    });
    await notify("PROOF_RECEIVED", booking.id);
    return result;
  } catch (e) {
    if (isDuplicateGcashRef(e)) {
      await deleteProof(path);
      throw new PaymentError("This GCash reference number has already been used for another booking.", 409);
    }
    if (isOverlapError(e) || e instanceof SlotTakenError) {
      // Keep their payment on record and flag it, so staff can rebook or settle with the customer.
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({ data: paymentData });
        await tx.booking.update({ where: { id: booking.id }, data: { attentionReason: SLOT_TAKEN_NOTE } });
        await audit(tx, "PROOF_SUBMITTED_SLOT_TAKEN", booking.id, null, { gcashRef });
      });
      await notify("NEEDS_ATTENTION", booking.id);
      return "SLOT_TAKEN";
    }
    await deleteProof(path);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 2. Confirm a payment (staff approval, or PayMongo webhook)
// ---------------------------------------------------------------------------
export type ConfirmResult = "CONFIRMED" | "CONFIRMED_AFTER_EXPIRY" | "ALREADY_PAID" | "PAID_NEEDS_ATTENTION" | "PAID_SLOT_TAKEN";

export async function confirmPayment(
  paymentId: string,
  by: { userId: string | null; source: "STAFF" | "PAYMONGO"; details?: Record<string, unknown> },
): Promise<ConfirmResult> {
  const now = new Date();
  const markPaid = (tx: Tx) =>
    tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: now, verifiedById: by.userId },
    });

  let bookingId = "";
  try {
    const result = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
      if (!p) throw new PaymentError("Payment not found.", 404);
      bookingId = p.bookingId;
      if (p.status === "PAID") return "ALREADY_PAID" as const;
      if (p.status === "REJECTED") throw new PaymentError("This payment was already rejected.", 409);
      if ((await markPaid(tx)).count !== 1) return "ALREADY_PAID" as const; // someone else just did it

      const b = p.booking;
      let outcome: ConfirmResult;
      if (b.status === "HOLD" || b.status === "PENDING_VERIFICATION") {
        await tx.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
        outcome = "CONFIRMED";
      } else if (b.status === "EXPIRED") {
        await revive(tx, b, "CONFIRMED");
        outcome = "CONFIRMED_AFTER_EXPIRY";
      } else {
        // Already confirmed (paid twice) or cancelled/rejected: keep the money on record, flag it.
        await tx.booking.update({
          where: { id: b.id },
          data: { attentionReason: `A payment was received while the booking was ${b.status}. Please review.` },
        });
        outcome = "PAID_NEEDS_ATTENTION";
      }

      // Any other unpaid attempts for this booking (e.g. abandoned PayMongo checkouts) are closed.
      await tx.payment.updateMany({
        where: { bookingId: b.id, id: { not: paymentId }, type: "RESERVATION_FEE", status: "PENDING" },
        data: { status: "REJECTED", rejectionReason: "Another payment for this booking was confirmed." },
      });
      await audit(tx, "PAYMENT_CONFIRMED", b.id, by.userId, { paymentId, source: by.source, outcome, ...by.details } as Prisma.InputJsonValue);
      return outcome;
    });

    if (result === "CONFIRMED" || result === "CONFIRMED_AFTER_EXPIRY") await notify("BOOKING_CONFIRMED", bookingId);
    if (result === "PAID_NEEDS_ATTENTION") await notify("NEEDS_ATTENTION", bookingId);
    return result;
  } catch (e) {
    if (!(isOverlapError(e) || e instanceof SlotTakenError)) throw e;
    await prisma.$transaction(async (tx) => {
      await markPaid(tx);
      await tx.booking.update({ where: { id: bookingId }, data: { attentionReason: SLOT_TAKEN_NOTE } });
      await audit(tx, "PAYMENT_CONFIRMED_SLOT_TAKEN", bookingId, by.userId, { paymentId, source: by.source } as Prisma.InputJsonValue);
    });
    await notify("NEEDS_ATTENTION", bookingId);
    return "PAID_SLOT_TAKEN";
  }
}

// ---------------------------------------------------------------------------
// 3. Reject a manual GCash proof (fake, wrong amount, not received)
// ---------------------------------------------------------------------------
export async function rejectPayment(paymentId: string, userId: string, reason: string) {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) throw new PaymentError("Please give a reason for rejecting.");

  const bookingId = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
    if (!p) throw new PaymentError("Payment not found.", 404);
    if (p.status !== "PENDING") throw new PaymentError(`This payment is already ${p.status.toLowerCase()}.`, 409);

    await tx.payment.update({ where: { id: p.id }, data: { status: "REJECTED", rejectionReason: cleanReason, verifiedById: userId } });

    const b = p.booking;
    if (b.status === "PENDING_VERIFICATION") {
      // Frees the slot: court bookings stop blocking once REJECTED; pool spots are given back.
      await tx.booking.update({ where: { id: b.id }, data: { status: "REJECTED" } });
      if (b.poolInventoryId)
        await tx.poolSessionInventory.update({
          where: { id: b.poolInventoryId },
          data: { reserved: { decrement: b.adults + b.kids } },
        });
    }
    await audit(tx, "PAYMENT_REJECTED", b.id, userId, { paymentId, reason: cleanReason });
    return b.id;
  });
  await notify("PAYMENT_REJECTED", bookingId, { reason: cleanReason, paymentId });
}

/** Payments waiting for staff, oldest first (used by the CLI now and the dashboard in Phase 5). */
export function pendingManualPayments() {
  return prisma.payment.findMany({
    where: { status: "PENDING", method: "GCASH_MANUAL" },
    orderBy: { createdAt: "asc" },
    include: { booking: { include: { amenity: true } } },
  });
}
