// Runs once when the server starts. On Render (always-on server) this replaces the
// external cron: scheduled housekeeping runs inside the app every 10 minutes.
// Turned on only when RUN_SCHEDULED_JOBS=1, so it never runs on your computer by accident.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_SCHEDULED_JOBS === "1") {
    await import("./instrumentation-node");
  }
}
