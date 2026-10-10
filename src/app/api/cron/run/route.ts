import { NextResponse } from "next/server";
import { cronAuthorized, runScheduledJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 10 minutes by cron-job.org (and once a day by Vercel Cron as a backup),
// with the header  Authorization: Bearer <CRON_SECRET>
async function handle(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runScheduledJobs();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("Scheduled job failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
