import { NextResponse } from "next/server";
import { cronAuthorized, runScheduledJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On Render the jobs run inside the app (src/instrumentation.ts). This endpoint stays as a
// manual/backup trigger, e.g. from cron-job.org, with the header  Authorization: Bearer <CRON_SECRET>
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
