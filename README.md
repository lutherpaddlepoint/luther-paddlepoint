# Luther PaddlePoint & Pool — Booking System

Online booking for the pickleball court and swimming pool at Necesito Place, Poblacion 3, Lebak, Sultan Kudarat.

**Status: complete (all 8 phases).** To put it online, follow **[DEPLOY.md](DEPLOY.md)**. To run the tests, see **[TESTING.md](TESTING.md)**.

## Business rules in this build

| Item | Rule |
|---|---|
| Hours | 6:00 AM – 10:00 PM daily |
| Pickleball court (1) | ₱200/hr 6 AM–5 PM, ₱250/hr 5 PM–10 PM; whole hours only; crossing 5 PM is priced hour by hour |
| Swimming pool | ₱50 adult, ₱30 kid (10 & below); day session 6 AM–5 PM, night session 5 PM–10 PM; 30 guests max per session; at least 1 adult per booking |
| Reservation fee | 50% of total, paid online via GCash, **non-refundable**; balance paid on-site |
| Rescheduling | Allowed once, if requested at least 24 hours before the booking |
| Payment mode | Manual GCash (screenshot + reference no., verified by staff) until PayMongo is set up |
| Accounts | 1 owner + 3 staff |

All of these are stored in the database (`rate_rules`, `pool_sessions`, `settings`) and will be editable in the owner dashboard (Phase 5).

## Project files (so far)

```
prisma/schema.prisma            Database tables
prisma/sql/constraints.sql      Double-booking protection, pool capacity limit, hold expiry
prisma/seed.ts                  Accounts, rates, sample bookings + automatic safety checks
scripts/append-constraints.mjs  Adds constraints.sql to the first migration

src/app/page.tsx                Home = booking page
src/app/booking/[ref]/page.tsx  Customer's private booking page (hold timer, details, status)
src/app/privacy/page.tsx        Privacy notice (fill in the [brackets])
src/app/api/availability        GET  schedule for a date (court hours + pool sessions)
src/app/api/bookings            POST place a hold on a slot
src/components/BookingWizard.tsx  Date strip, court timeline, pool sessions, details form
src/components/HoldCountdown.tsx  Live hold timer
src/components/PaymentBox.tsx   GCash payment: QR + Ref. No. + screenshot, or PayMongo button
src/app/api/bookings/[ref]/proof     POST customer's GCash proof
src/app/api/bookings/[ref]/checkout  POST start a PayMongo GCash checkout
src/app/api/webhooks/paymongo        POST PayMongo tells us a payment succeeded

src/lib/payments.ts             Submit proof, approve, reject, recover expired holds
src/lib/payment-core.ts         Ref. No. check, image check, PayMongo signature check
src/lib/storage.ts              Private storage for receipt screenshots (Supabase)
src/lib/paymongo.ts             PayMongo checkout + webhook registration
src/lib/notify.ts               Decides who gets which message; records it, then sends
src/lib/templates.ts            Wording of every email and SMS (edit here to change messages)
src/lib/senders.ts              Gmail (SMTP) and Semaphore SMS delivery
src/lib/qr.ts                   Booking QR codes
src/lib/jobs.ts                 Scheduled job: reminders, retries, auto-complete, screenshot cleanup
src/app/api/cron/run            URL the scheduler calls every 10 minutes
vercel.json                     Daily backup run of the scheduled job
scripts/payments.ts             Staff tool: list / approve / reject payments
src/lib/pricing.ts              Price calculation (day/night, crossover, pool, 50% fee)
src/lib/availability-core.ts    Which hours/sessions are open, booked, closed or passed
src/lib/availability.ts         Loads the schedule from the database
src/lib/bookings.ts             Creates holds safely (court and pool)
src/lib/selection.ts            How tapping court hours builds a time block
src/lib/phone.ts                PH mobile number checking (0917…, +63 917…)
src/lib/validation.ts           Form and request checks
src/lib/rate-limit.ts           Slows down spam and abuse
src/lib/time.ts                 Manila time helpers (UTC+8)
src/lib/defaults.ts             Starting rates and settings

src/app/admin/                  Staff/owner dashboard (login, today, payments, calendar, check-in,
                                walk-in, blocks, reports, settings, my account) + actions.ts
src/components/admin/           Dashboard building blocks (forms, QR scanner, schedules)
src/lib/auth.ts, session-core.ts  Login sessions
src/lib/admin-ops.ts            Walk-ins, check-in, balances, no-shows, cancel, reschedule, blocks
src/lib/admin-data.ts           Data for the dashboard pages
src/lib/admin-core.ts           Report calculations, CSV safety
src/lib/settings-admin.ts       Rates, hours, payment settings, staff accounts

tests/                          31 quick tests (no database needed): npm test
tests/db/                       43 tests against a real throwaway database: npm run test:db
TESTING.md                      How to run the tests, what they prove, and a by-hand checklist
DEPLOY.md                       Going live step by step, daily running, PayMongo later, troubleshooting
scripts/setup-production.ts     Sets up an empty live database + owner account (no sample data)
scripts/supabase-lockdown.ts    Closes Supabase's public Data API
scripts/check-env.ts            Checks your live settings before launch
src/app/api/health              Uptime check (is the database reachable?)
docker-compose.test.yml         The throwaway test database
.github/workflows/test.yml      Runs everything automatically on GitHub
```

## How booking works for the customer

1. Choose **Pickleball court** or **Swimming pool**, then a date (today up to 30 days ahead).
2. **Court:** tap an hour, then the next hour to extend. Night hours (from 5 PM, when the lights come on) are shown in a darker band with the ₱250 rate. Booked, closed and passed hours can't be tapped.
   **Pool:** choose the day or night session (each shows spots left out of 30), then the number of adults and kids.
3. The total, the 50% reservation fee, and the on-site balance update live at the bottom of the screen.
4. Enter name, mobile and email, and tick the non-refundable policy and privacy notice.
5. The system recomputes the price on the server, places a 30-minute hold, and opens the customer's private booking page with a countdown.
6. The customer pays the reservation fee (see "How GCash payment works" below).

If someone else grabs the same time while a customer is filling in the form, the customer is sent back to the schedule with a message and the updated availability.

## Setup

1. **Create a free Supabase project** at supabase.com. Choose the Singapore region (closest to the Philippines).
2. **Copy the environment file** and paste in your connection strings from Supabase → Project Settings → Database:
   ```bash
   cp .env.example .env
   ```
3. **Install packages:**
   ```bash
   npm install
   ```
4. **Create the database** (three commands, in this order):
   ```bash
   npm run db:create-init        # generates the migration without running it
   npm run db:append-constraints # adds the double-booking protection to it
   npm run db:migrate            # applies it to Supabase
   ```
5. **Load sample data:**
   ```bash
   npm run db:seed
   ```
   The seed prints the owner and staff passwords once — save them. It also runs four safety checks against the real database and stops with an error if any fails:
   - an overlapping court booking is rejected
   - back-to-back bookings (8–10 AM then 10–11 AM) are allowed
   - unpaid holds expire and release the slot
   - the pool cannot go above 30 guests
6. **Run the tests:**
   ```bash
   npm test
   ```
7. **Start the website:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 on your computer, or on your phone using your computer's local IP address.

> **Already ran Phase 2 setup?** Phase 3 added an `access_token` column to bookings. Delete the `prisma/migrations` folder, then run `npx prisma migrate reset --skip-seed` (this empties the database) and repeat steps 4 and 5. (Only do this while you're still using sample data.)

### Phase 6 setup (notifications)

1. `npm install` (adds email and QR code libraries).
2. Add the notifications table:
   ```bash
   npx prisma migrate dev --name phase6_notifications --create-only
   ```
   Check the new `migration.sql` only creates things (no `DROP`), then `npm run db:migrate`.
3. **Email through Gmail** (free, no domain needed). Use a Gmail account for the business:
   - Turn on 2-Step Verification for that Google account.
   - Go to https://myaccount.google.com/apppasswords and create an app password.
   - Put the account and the 16-character app password in `.env` (`SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`).
   - Gmail allows a few hundred emails per day, plenty for one court and a pool. Sent emails appear in that Gmail's Sent folder.
4. In the dashboard, **Settings → Booking and payment**: fill in how customers can contact you and the staff alert emails. Use **Send test email** to check it works.
5. **Scheduled job** (needed for reminders). After deploying to Vercel:
   - Add `CRON_SECRET` (any long random value) to your Vercel environment variables.
   - Create a free account at https://cron-job.org and add a job:
     URL `https://your-site.vercel.app/api/cron/run`, every 10 minutes,
     with the request header `Authorization: Bearer <your CRON_SECRET>`.
   - Vercel also runs it once a day as a backup (`vercel.json`), but on the free plan Vercel can't run it often enough for 2-hour reminders, which is why cron-job.org is used.
6. **SMS (optional):** create a Semaphore account at semaphore.co, buy credits, and put the API key in `SEMAPHORE_API_KEY`. A custom sender name (e.g. "LutherPP") must be approved by Semaphore first; until then leave `SEMAPHORE_SENDER_NAME` empty.

Without email or SMS settings, nothing breaks: messages are recorded as "skipped" and printed in the server log.

### Phase 5 setup (dashboard)

1. Add a `SESSION_SECRET` to `.env` (and later to Vercel). Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. Run `npm install` again (adds the QR scanner library).
3. Start the site and open http://localhost:3000/admin/login.

No database changes in Phase 5.

### Phase 4 setup (payments)

1. In Supabase → Project Settings → API, copy the **Project URL** and the **service_role** key into `.env` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service role key secret.
2. Create the private screenshot storage:
   ```bash
   npm run storage:setup
   ```
3. Apply the Phase 4 database changes (two new columns):
   ```bash
   npx prisma migrate dev --name phase4_payments --create-only
   ```
   Open the new `migration.sql` and confirm it only **adds** columns (see the note on future migrations), then apply it with `npm run db:migrate`. If you're setting up from scratch, this step just says there's nothing to change.
4. Put your GCash QR image at `public/gcash-qr.png`, then set your real GCash details. Either edit `gcash_account` in `src/lib/defaults.ts` before seeding, or run this in Supabase → SQL Editor:
   ```sql
   UPDATE settings
      SET value = '{"name": "YOUR NAME", "number": "0917 123 4567", "qrImagePath": "/gcash-qr.png"}'
    WHERE key = 'gcash_account';
   ```
5. Try the whole flow: book a slot on your phone, send a small GCash amount, submit the proof, then run `npm run payments` and `npm run payments approve LPP-…`. Refresh the booking page: it should say **You're booked**.



## How GCash payment works

### Now: manual GCash (no business registration needed)

1. The booking page shows your GCash QR, account name, number and the **exact** amount, with copy buttons.
2. The customer pays in their GCash app, then enters the **Ref. No.** from the receipt and attaches the screenshot. Big screenshots are shrunk on the phone first, to save mobile data.
3. The booking changes to **waiting for verification**. The slot stays blocked; it does not expire while staff check it.
4. Staff open GCash, find the payment by Ref. No. and amount, then approve or reject:
   ```bash
   npm run payments                                   # list proofs waiting, with a 15-minute link to each screenshot
   npm run payments approve LPP-7K3QX                 # booking becomes CONFIRMED
   npm run payments reject LPP-7K3QX "Not received"   # slot is released
   ```
   These commands still work, but staff will normally use the **Payments** page in the dashboard instead.

**Protections:** the same GCash Ref. No. can't be used twice. Screenshots are checked to be real images and stored privately (only staff can open them, through links that expire). The price on the screenshot is checked by a human against the actual GCash app, since screenshots can be edited.

**Paid late?** If the 30-minute hold runs out, the customer can still submit proof. If the slot is still free, the booking is restored automatically. If someone else took it, the payment is kept on record and the booking is flagged "needs attention" so staff can contact the customer to rebook.

### Later: PayMongo (automatic confirmation)

After your DTI registration and PayMongo approval:

1. Add `PAYMONGO_SECRET_KEY` (start with the `sk_test_...` key) to `.env` and to Vercel.
2. Deploy the site, then register the webhook and copy the secret it prints into `PAYMONGO_WEBHOOK_SECRET`:
   ```bash
   npm run paymongo:webhook https://your-site.vercel.app
   ```
3. Change the `payment_mode` setting to `"GCASH_PAYMONGO"` (dashboard in Phase 5, or SQL below).

Customers then tap **Pay with GCash**, pay on PayMongo's GCash page, and come back. The booking is confirmed only when PayMongo's signed webhook arrives, never just because the customer was redirected back. If the webhook arrives twice, the booking is still confirmed once. PayMongo charges a fee per transaction; check their current rates.

## Notifications

| When | Customer email | Customer SMS* | Staff alert email |
|---|:-:|:-:|:-:|
| GCash proof submitted | ✓ "We got your payment proof" |  | ✓ "Payment to check" |
| Booking confirmed | ✓ with QR code, details, balance | ✓ |  |
| Payment rejected | ✓ with the reason | optional |  |
| Reminder, 2 hours before | ✓ with QR code and balance to bring | ✓ |  |
| Rescheduled | ✓ with new time and QR code | optional |  |
| Cancelled | ✓ |  |  |
| Something needs attention |  |  | ✓ |

\*SMS only if Semaphore is set up; the owner picks which events get SMS in **Settings** (each SMS costs money).

The customer's booking page also shows the QR code once the booking is confirmed, so check-in works even if an email is missed. The QR holds only the reference code, no personal details.

**Reliability:** every message is recorded before it's sent. The same message is never sent twice (even if a payment is approved twice). A message that fails is retried up to 5 times by the scheduled job. A message that's no longer true (e.g. "confirmed" for a booking cancelled since) is skipped instead of sent.

**The scheduled job** (every 10 minutes) also: releases unpaid holds, marks checked-in bookings as completed after they end, and deletes GCash screenshots 90 days after the booking date, as promised in the privacy notice.

## The dashboard

Open **/admin/login** (e.g. `http://localhost:3000/admin/login`) and log in with the accounts printed by the seed. It works on phones; staff can keep it open at the counter.

| Page | Staff | Owner | What it's for |
|---|:-:|:-:|---|
| Today | ✓ | ✓ | Today's court timeline and pool sessions, money collected, balance still to collect, quick search by reference code |
| Payments | ✓ | ✓ | GCash screenshots to approve or reject (with reasons), and bookings that need attention |
| Calendar | ✓ | ✓ | Day view, or a week grid of the court and pool counts |
| Booking page | ✓ | ✓ | Full details, payments, history; check in, collect balance, mark no-show, add notes |
| Check-in | ✓ | ✓ | Scan the customer's QR code with the phone camera, or type the reference code |
| Walk-in | ✓ | ✓ | Book for walk-ins or phone calls; shows exactly how much to collect |
| Reschedule, cancel |  | ✓ | On the booking page. Reschedule follows the policy (once, 24 hours ahead) unless the owner ticks "Allow anyway" |
| Blocks |  | ✓ | Block court hours or close a pool session for maintenance/events |
| Reports |  | ✓ | Money collected (GCash vs cash), booking value (day vs night, court vs pool), court occupancy, pool guests, busiest hours, day-by-day table, Excel download |
| Settings |  | ✓ | Rates, hours, pool capacity, reservation %, hold time, GCash details, payment method, staff accounts |

**Security:** passwords are stored hashed; login is limited to 5 tries per 15 minutes; sessions last 12 hours; changing or resetting a password logs that account out everywhere; deactivated staff are locked out immediately; every action is checked on the server (hiding a button isn't relied on) and recorded in the booking history.

**Good to know:**
- "Collected" in reports is money actually received in that period. "Value" is the full price of bookings in that period, including balances not yet paid.
- No-show keeps the reservation fee and frees the pool spots for others.
- Cancelling frees the slot; the reservation fee is not refunded.
- Closing a pool session doesn't cancel existing bookings. You get a list of people to contact.
- Each booking page in the dashboard lists the emails/SMS sent for it, and any that failed.

## How double booking is prevented

- **Court:** a PostgreSQL exclusion constraint (`bookings_no_overlap`) refuses any two active court bookings or blocks whose times overlap. Because the database enforces it, two customers tapping "Book" at the same second cannot both succeed.
- **Pool:** each session/date has a `reserved` counter. `reserve_pool_spots()` adds guests only if the total stays ≤ 30, in a single atomic statement. A CHECK constraint backs this up.
- **Holds:** when a customer starts paying, the slot is held (30 min for manual GCash, 10 min for PayMongo). `expire_stale_holds()` runs at the start of every availability check and booking, so unpaid holds free up without needing a scheduled job.
- **Reused GCash screenshots:** the same GCash reference number can't be used for two bookings.

## Important note for future migrations

Prisma doesn't know about the rules in `constraints.sql`. Whenever you create a new migration later, open the generated `migration.sql` and make sure it does **not** contain `DROP` statements for `bookings_no_overlap`, `payments_gcash_reference_unique`, or the functions `expire_stale_holds` and `reserve_pool_spots`. If it does, delete those lines before applying it.

## Going live

See **[DEPLOY.md](DEPLOY.md)**. In short: a separate, empty Supabase project for the live site (never run `npm run db:seed` on it; use `npm run setup:production`), `npm run db:lockdown`, Vercel **Pro** (the free Hobby plan doesn't allow business use), the environment variables, and the 10-minute background job.
