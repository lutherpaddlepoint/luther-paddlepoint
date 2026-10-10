import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { tokenMatches } from "@/lib/payments";
import { createGcashCheckout } from "@/lib/paymongo";
import { expireStaleHolds } from "@/lib/availability";
import { formatMinute, utcToManila } from "@/lib/time";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { ref: string } }) {
  if (!rateLimit(`checkout:${clientIp(req)}`, 10, 10 * 60_000))
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });

  const settings = await getSettings();
  if (settings.payment_mode !== "GCASH_PAYMONGO")
    return NextResponse.json({ error: "Online checkout is not enabled." }, { status: 400 });

  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  await expireStaleHolds();
  const b = await prisma.booking.findUnique({ where: { referenceCode: params.ref }, include: { amenity: true } });
  if (!b || !token || !tokenMatches(b, token)) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (b.status !== "HOLD")
    return NextResponse.json({ error: "This booking is no longer waiting for payment. Please refresh the page." }, { status: 409 });

  const appUrl = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const pageUrl = `${appUrl}/booking/${b.referenceCode}?t=${encodeURIComponent(token)}`;
  const s = utcToManila(b.startAt);
  const e = utcToManila(b.endAt);
  const description = `${b.amenity.name}, ${s.date}, ${formatMinute(s.minuteOfDay)} to ${formatMinute(e.minuteOfDay)}`;

  try {
    const checkout = await createGcashCheckout({
      referenceCode: b.referenceCode,
      description,
      amountCentavos: b.reservationFeeCentavos,
      successUrl: `${pageUrl}&paid=1`,
      cancelUrl: pageUrl,
      customer: { name: b.customerName, email: b.email, phone: b.mobile },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id, type: "RESERVATION_FEE", method: "GCASH_PAYMONGO",
        amountCentavos: b.reservationFeeCentavos, providerPaymentId: checkout.id, status: "PENDING",
      },
    });
    return NextResponse.json({ url: checkout.checkoutUrl });
  } catch (err) {
    console.error("PayMongo checkout failed", err);
    return NextResponse.json({ error: "GCash checkout is unavailable right now. Please try again shortly." }, { status: 502 });
  }
}
