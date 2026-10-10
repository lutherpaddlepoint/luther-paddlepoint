import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { confirmPayment } from "@/lib/payments";
import { verifyPaymongoSignature } from "@/lib/payment-core";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

// PayMongo calls this when a GCash checkout is paid. The booking is confirmed ONLY here,
// never from the browser redirect, because a redirect can be faked.
export async function POST(req: Request) {
  const raw = await req.text();
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const livemode = Boolean(event?.data?.attributes?.livemode);
  const ok = verifyPaymongoSignature(
    req.headers.get("paymongo-signature"),
    raw,
    process.env.PAYMONGO_WEBHOOK_SECRET ?? "",
    livemode,
  );
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const type = event?.data?.attributes?.type;
  if (type !== "checkout_session.payment.paid") return NextResponse.json({ received: true, ignored: type });

  const session = event.data.attributes.data;
  const checkoutId: string | undefined = session?.id;
  const paid = (session?.attributes?.payments ?? []).find((p: any) => p?.attributes?.status === "paid");
  if (!checkoutId || !paid) return NextResponse.json({ received: true, ignored: "no paid payment" });

  const payment = await prisma.payment.findUnique({ where: { providerPaymentId: checkoutId } });
  if (!payment) {
    console.warn("PayMongo webhook for unknown checkout", checkoutId);
    return NextResponse.json({ received: true, ignored: "unknown checkout" });
  }

  try {
    if (paid.attributes.amount !== payment.amountCentavos) {
      await prisma.booking.update({
        where: { id: payment.bookingId },
        data: { attentionReason: `PayMongo amount ${paid.attributes.amount / 100} does not match the fee ${payment.amountCentavos / 100}.` },
      });
      await notify("NEEDS_ATTENTION", payment.bookingId);
      return NextResponse.json({ received: true, flagged: "amount mismatch" });
    }
    const result = await confirmPayment(payment.id, {
      userId: null,
      source: "PAYMONGO",
      details: { paymongoPaymentId: paid.id, livemode },
    });
    return NextResponse.json({ received: true, result });
  } catch (e) {
    console.error("Webhook processing failed", e);
    // 500 makes PayMongo retry later. confirmPayment is safe to run twice.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
