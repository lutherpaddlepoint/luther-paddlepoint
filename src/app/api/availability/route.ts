import { NextResponse } from "next/server";
import { getAvailability, bookingWindow } from "@/lib/availability";
import { getSettings } from "@/lib/settings";
import { AvailabilityQuerySchema } from "@/lib/validation";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`avail:${clientIp(req)}`, 120, 60_000))
    return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });

  const url = new URL(req.url);
  const parsed = AvailabilityQuerySchema.safeParse({ date: url.searchParams.get("date") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const settings = await getSettings();
  const { firstDate, lastDate } = bookingWindow(settings.booking_window_days);
  const date = parsed.data.date;
  if (date < firstDate || date > lastDate)
    return NextResponse.json({ error: "That date is outside the booking window." }, { status: 400 });

  const data = await getAvailability(date);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
