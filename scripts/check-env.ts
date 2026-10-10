// Checks your settings before going live.  npm run check:env
// (To check Vercel's values: `npx vercel env pull .env.production`, then
//  npx tsx --env-file=.env.production scripts/check-env.ts)
const env = process.env;
const problems: string[] = [];
const warnings: string[] = [];

const need = (k: string, test: (v: string) => boolean, why: string) => {
  const v = env[k];
  if (!v) problems.push(`${k} is missing. ${why}`);
  else if (!test(v)) problems.push(`${k} looks wrong. ${why}`);
};

need("DATABASE_URL", (v) => v.startsWith("postgres") && v.includes("6543") && v.includes("pgbouncer=true"),
  "Use Supabase's pooled connection (port 6543) ending with ?pgbouncer=true&connection_limit=1");
need("DIRECT_URL", (v) => v.startsWith("postgres") && v.includes("5432"), "Use Supabase's direct/session connection (port 5432).");
need("APP_URL", (v) => /^https:\/\/[^/]+$/.test(v), 'Your live address with https and no trailing slash, e.g. "https://luther-paddlepoint.vercel.app".');
need("SESSION_SECRET", (v) => v.length >= 32, "At least 32 random characters.");
need("CRON_SECRET", (v) => v.length >= 16, "At least 16 random characters.");
need("SUPABASE_URL", (v) => /^https:\/\/.+\.supabase\.co$/.test(v), "Like https://abcd.supabase.co");
need("SUPABASE_SERVICE_ROLE_KEY", (v) => v.length > 40, "Supabase → Project Settings → API → service_role key.");

if (!env.SMTP_USER || !env.SMTP_PASS) warnings.push("Email is not set up (SMTP_USER / SMTP_PASS): customers won't get confirmations or QR codes.");
else if (env.SMTP_PASS.replace(/\s/g, "").length !== 16 && env.SMTP_HOST === "smtp.gmail.com")
  warnings.push("SMTP_PASS should be the 16-character Gmail app password, not your normal Gmail password.");
if (!env.SEMAPHORE_API_KEY) warnings.push("SMS is off (no SEMAPHORE_API_KEY). That's fine; emails still go out.");
if (!!env.PAYMONGO_SECRET_KEY !== !!env.PAYMONGO_WEBHOOK_SECRET)
  problems.push("PayMongo needs both PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET (or neither, for manual GCash).");
if (env.PAYMONGO_SECRET_KEY?.startsWith("sk_test_")) warnings.push("PayMongo is using a TEST key: no real money will be collected.");
for (const k of ["SESSION_SECRET", "CRON_SECRET"]) if (env[k] && /test|change|secret|example/i.test(env[k]!)) problems.push(`${k} looks like a placeholder. Generate a random one.`);

for (const w of warnings) console.log(`  warning: ${w}`);
for (const p of problems) console.log(`  PROBLEM: ${p}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s) to fix before going live.`);
  process.exitCode = 1;
} else console.log("\nSettings look ready for production.");
