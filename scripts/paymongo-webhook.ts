// One-time (after PayMongo approval): registers your webhook and prints its secret.
//   npm run paymongo:webhook https://your-site.vercel.app
import { registerWebhook } from "../src/lib/paymongo";

const base = (process.argv[2] ?? process.env.APP_URL ?? "").replace(/\/$/, "");
if (!base.startsWith("https://")) {
  console.error("Give your public https address, e.g. npm run paymongo:webhook https://luther.vercel.app");
  process.exit(1);
}
registerWebhook(`${base}/api/webhooks/paymongo`)
  .then(({ id, secret }) => {
    console.log(`Webhook ${id} registered.\nAdd this to your environment variables (Vercel + .env):\n\nPAYMONGO_WEBHOOK_SECRET="${secret}"\n`);
  })
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
