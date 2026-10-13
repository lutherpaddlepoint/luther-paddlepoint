import { runScheduledJobs } from "./lib/jobs";

const EVERY_MS = 10 * 60_000;
const g = globalThis as unknown as { __lppJobsTimer?: NodeJS.Timeout };

let running = false;
async function tick() {
  if (running) return; // never overlap two runs
  running = true;
  try {
    const summary = await runScheduledJobs();
    console.log("[scheduled jobs]", JSON.stringify(summary));
  } catch (e) {
    console.error("[scheduled jobs] failed", e);
  } finally {
    running = false;
  }
}

if (!g.__lppJobsTimer) {
  g.__lppJobsTimer = setInterval(tick, EVERY_MS);
  setTimeout(tick, 60_000); // first run a minute after start-up
  console.log("[scheduled jobs] running every 10 minutes");
}
