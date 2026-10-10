import { NextResponse } from "next/server";
import { CreateBookingSchema } from "@/lib/validation";
import { createHold, BookingError } from "@/lib/bookings";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`book:${clientIp(req)}`, 10, 10 * 60_000))
    return NextResponse.json({ error: "Too many booking attempts. Please try again in a few minutes." }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = CreateBookingSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return NextResponse.json({ error: "Please check the highlighted fields.", fieldErrors }, { status: 422 });
  }

  try {
    const { referenceCode, accessToken } = await createHold(parsed.data);
    return NextResponse.json({ referenceCode, url: `/booking/${referenceCode}?t=${accessToken}` }, { status: 201 });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Booking failed", e);
    return NextResponse.json({ error: "Booking could not be saved. Please try again." }, { status: 500 });
  }
}
