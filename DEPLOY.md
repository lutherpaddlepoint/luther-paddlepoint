# Going live: Luther PaddlePoint & Pool booking system

This guide takes the project from your computer to a live website customers can use. Follow the steps in order. It takes about 2 to 3 hours the first time.

---

## Before you start

### Accounts you'll need

| Service | What it does | Cost |
|---|---|---|
| **GitHub** (github.com) | Stores the code; Vercel deploys from it | Free |
| **Vercel** (vercel.com) | Runs the website | **Pro plan: $20/month** (see below) |
| **Supabase** (supabase.com) | Database and private screenshot storage | Free plan is enough to start |
| **Gmail** (a business Gmail account) | Sends confirmation and reminder emails | Free |
| **cron-job.org** | Runs the 10-minute background job (only if you stay on Vercel's free plan) | Free |
| **Semaphore** (semaphore.co) | SMS, optional | Pay per SMS (about ₱0.50 each; check current rates) |
| **PayMongo** (later) | Automatic GCash confirmation | Fee per transaction; needs DTI registration |

### Important: which Vercel plan

Vercel's free **Hobby** plan is only for personal, non-commercial projects. A booking site that takes payments for a business counts as commercial, so Vercel's terms require the **Pro** plan ($20 per user per month; one user is enough). You can still use the free `your-name.vercel.app` web address on Pro.

Pro also makes things simpler: it can run the background job every 10 minutes by itself, so you won't need cron-job.org (step 6), and it keeps logs longer when you need to investigate a problem.

If $20/month is a problem, the app can be moved to a host whose free plan allows business use, but that requires changes to the project. Ask before doing this; don't launch a business on the Hobby plan.

### Use a separate database for the live site

If you used a Supabase project while building and testing (with the sample data from `npm run db:seed`), keep it for testing. Create a **new, empty** Supabase project for the live site. Never run `npm run db:seed` on the live database: it deletes everything.

---

## Step 1: Put the code on GitHub

1. Create a **private** repository on GitHub (e.g. `luther-paddlepoint`).
2. Make sure these are committed: `package-lock.json`, the whole `prisma/migrations` folder (it contains the double-booking protection), and your GCash QR image at `public/gcash-qr.png` if you have it.
3. Make sure these are **never** committed: `.env`, `.env.test`, `.env.production`. They're already listed in `.gitignore`.
4. Push the code. If the GitHub test workflow runs, check it passes (green tick).

---

## Step 2: Set up the live database (Supabase)

1. In Supabase, create a new project. Region: **Southeast Asia (Singapore)**. Save the database password somewhere safe.
2. **Project Settings → Database → Connection string**, copy two strings:
   - **Transaction pooler** (port **6543**). Add `?pgbouncer=true&connection_limit=1` to the end. This is `DATABASE_URL`.
   - **Session pooler** or direct connection (port **5432**). This is `DIRECT_URL`.
3. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and the **service_role** key (`SUPABASE_SERVICE_ROLE_KEY`). The service_role key is a master key: never share it or put it in the code.
4. On your computer, make a copy of your `.env` for the live site (e.g. keep your testing one as `.env.dev`) and put the live values from steps 2–3 into `.env`. Then run, in order:
   ```bash
   npm run db:deploy          # creates all tables and safety rules from prisma/migrations
   npm run db:lockdown        # closes Supabase's public Data API (important, see below)
   npm run storage:setup      # creates the private bucket for GCash screenshots
   npm run setup:production -- --name "Your Name" --email you@gmail.com
   ```
   The last command creates the court, pool, rates, settings and **your owner account**, and prints your password **once**. Save it.

**Why the lockdown step matters:** every Supabase project has a public "Data API". This app doesn't use it, but if left open it could let outsiders read bookings or call the pool-reservation function directly. `db:lockdown` closes it. Run it again after every future database change.

---

## Step 3: Gmail for sending emails

1. Use the business Gmail account (e.g. `lutherpaddlepoint@gmail.com`).
2. Turn on **2-Step Verification** for it.
3. Go to https://myaccount.google.com/apppasswords, create an app password named "Booking site", and copy the 16 characters.
4. You'll paste it into Vercel in step 4 as `SMTP_PASS`.

---

## Step 4: Deploy on Vercel

1. In Vercel, **Add New → Project**, import the GitHub repository. Vercel detects Next.js automatically; leave the build settings as they are.
2. Pick the project name carefully: it becomes your address, e.g. `luther-paddlepoint` → `https://luther-paddlepoint.vercel.app`.
3. Before the first deploy, open **Environment Variables** and add these (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler string (port 6543, with `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | Supabase session/direct string (port 5432) |
| `APP_URL` | `https://luther-paddlepoint.vercel.app` (your address, no slash at the end) |
| `SESSION_SECRET` | A new random value (command below) |
| `CRON_SECRET` | Another new random value |
| `SUPABASE_URL` | From step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 2 |
| `PROOF_BUCKET` | `payment-proofs` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | The business Gmail address |
| `SMTP_PASS` | The 16-character app password |
| `EMAIL_FROM` | `Luther PaddlePoint & Pool <lutherpaddlepoint@gmail.com>` |
| `SEMAPHORE_API_KEY` | Optional: only if you want SMS |
| `SEMAPHORE_SENDER_NAME` | Optional: only after Semaphore approves a sender name |

   Generate each random value with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Use different values for the live site than for testing.

4. Click **Deploy**. When it finishes, open `https://your-address.vercel.app/api/health`. It should show `{"ok":true}`. If it shows `false`, the database settings are wrong (see Troubleshooting).
5. Optional check of all settings from your computer:
   ```bash
   npx vercel env pull .env.production
   npx tsx --env-file=.env.production scripts/check-env.ts
   ```
   Delete `.env.production` afterwards.

---

## Step 5: First login and settings

1. Open `/admin/login`, log in with the owner account from step 2, then go to **My account** and change the password.
2. **Settings → Booking and payment**:
   - GCash account name and number, and the QR image path (`/gcash-qr.png`, if you committed the image in step 1).
   - How customers can contact you (mobile number or Facebook page).
   - Staff alert emails (who gets "payment to check" emails).
   - Which events send SMS (only if Semaphore is set up).
3. Press **Send test email** and check it arrives (look in Spam too, and mark it "Not spam").
4. **Settings → Rates and hours**: confirm ₱200 day / ₱250 night from 5 PM, pool ₱50 adult / ₱30 kid, 30 guests, 6 AM–10 PM.
5. **Settings → Staff accounts**: add your 3 staff. Give each their temporary password in person, and ask them to change it under **My account**.

---

## Step 6: The 10-minute background job

This job sends the 2-hour reminders, retries failed emails, releases unpaid holds, and deletes old screenshots.

**On Vercel Pro (recommended):** edit `vercel.json` to:
```json
{ "crons": [{ "path": "/api/cron/run", "schedule": "*/10 * * * *" }] }
```
Commit and push. Vercel sends your `CRON_SECRET` automatically. Check **Vercel → Project → Settings → Cron Jobs** shows it.

**On the free plan (testing only):** keep `vercel.json` as it is (once a day) and create a job at cron-job.org:
- URL: `https://your-address.vercel.app/api/cron/run`
- Every 10 minutes
- Header: `Authorization` = `Bearer <your CRON_SECRET>`
- Turn on "notify me on failure".

Either way, the job also keeps the Supabase free project active (Supabase pauses free projects that go unused for about a week).

---

## Step 7: Final checks before announcing

1. Go through the **"Checks to do by hand"** list in `TESTING.md` on a real phone, using mobile data.
2. Make one real booking yourself: pay a real reservation fee with GCash, approve it as staff, confirm the email with the QR code arrives, scan it at **Check-in**, record the balance. Then cancel it from the dashboard.
3. Book a slot about 2½ hours ahead and confirm the reminder arrives 2 hours before.
4. Check **Reports** shows your test money, then you're ready.

---

## Step 8: Launch

- Share the link on your Facebook page and Messenger auto-reply.
- Print a poster at the counter with a QR code of your booking address (any free QR generator works) so walk-ins can book the next time online.
- Tell regular customers: book online, pay 50% by GCash, balance on-site.
- For the first week, have staff keep the **Payments** page open and approve proofs quickly.

---

## Running it day to day

**Staff, every shift:** open **Today**. Approve GCash proofs on **Payments** (always check the real GCash app, never just the screenshot). Check in customers with the QR scanner. Add walk-ins on **Walk-in** so the slot is blocked online.

**Owner, monthly:** download the month's report (**Reports → Download for Excel**) and keep it. This is also your simplest backup. The free Supabase plan doesn't include backups you can restore yourself; check Supabase's current plans if you want automatic daily backups.

**Changing rates or hours:** **Settings → Rates and hours**. Existing bookings keep their price.

**When a staff member leaves:** **Settings → Staff accounts → Deactivate**. They're locked out immediately.

### Updating the system later

- **Code changes:** push to GitHub; Vercel deploys automatically. If a new version has a problem, open **Vercel → Deployments**, pick the previous one and choose **Instant Rollback**.
- **Database changes** (new migrations): always in this order, from your computer with the live `.env`:
  ```bash
  npx prisma migrate dev --name describe_change --create-only   # on your TEST database first
  # open the new migration.sql: it must not DROP bookings_no_overlap, payments_gcash_reference_unique,
  # expire_stale_holds or reserve_pool_spots
  npm run test:db                                                 # all tests must pass
  npm run db:deploy                                               # then apply to the live database
  npm run db:lockdown                                             # and lock down any new tables
  ```

---

## Later: switching to automatic GCash (PayMongo)

1. Register the business with **DTI** (and get a Mayor's/Business permit and BIR registration as required).
2. Apply for a PayMongo account and complete their verification.
3. Add `PAYMONGO_SECRET_KEY` to Vercel. Start with the **test** key (`sk_test_...`).
4. Register the webhook:
   ```bash
   PAYMONGO_SECRET_KEY=sk_test_... npm run paymongo:webhook https://your-address.vercel.app
   ```
   Add the printed `PAYMONGO_WEBHOOK_SECRET` to Vercel and redeploy.
5. In **Settings**, switch the payment method to **PayMongo GCash**. Make a test booking; it should confirm by itself within seconds.
6. When it works, replace both with your **live** keys (`sk_live_...`, and register the webhook again with the live key), redeploy, and make one small real payment to confirm.

Manual GCash keeps working as a fallback: switch back in **Settings** at any time.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `/api/health` shows `"ok": false` | `DATABASE_URL` is wrong. Use the port **6543** pooler string with `?pgbouncer=true&connection_limit=1`, and check the database password. Redeploy after changing variables. |
| Login says "Something went wrong" | `SESSION_SECRET` is missing or shorter than 32 characters. |
| Customers can't upload GCash screenshots | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` wrong, or `npm run storage:setup` wasn't run on the live project. |
| Test email fails with "Invalid login" | `SMTP_PASS` must be the Gmail **app password**, not the normal password; 2-Step Verification must be on. |
| Emails land in Spam | Ask a few customers to mark them "Not spam". Sending from a Gmail account through Gmail's own server is the most reliable free option. |
| No reminders | The 10-minute job isn't running: check Vercel Cron Jobs (Pro) or cron-job.org's history. A `401` means the `CRON_SECRET` doesn't match. |
| QR scanner won't open the camera | Allow camera access for the site in the phone's browser settings. It only works on the `https://` address. |
| Pages show old rates | Hard-refresh the page. If still wrong, check **Settings → Rates and hours** was saved. |
| A failed email on a booking | Open the booking in the dashboard: "Notes and history" shows each message and the error. It's retried automatically up to 5 times. |
| Something else | Vercel → Project → **Logs** shows server errors. Note the time it happened and the reference code. |
