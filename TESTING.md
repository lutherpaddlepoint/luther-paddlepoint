# Testing

## Automatic tests

| Command | What it checks | Needs |
|---|---|---|
| `npm test` | Prices, day/night crossover, slot rules, phone numbers, GCash Ref. No. and image checks, PayMongo signatures, login sessions, reports, email/SMS wording (31 tests) | Nothing |
| `npm run test:db` | The real booking rules against a real (throwaway) database (43 tests, listed below) | Docker Desktop |

### Running the database tests

1. Install Docker Desktop and start it.
2. `cp .env.test.example .env.test`
3. `npm run test:db:start` (starts a throwaway database on port 54329; it's wiped when stopped)
4. `npm run test:db`

The tests refuse to run unless the database is on `localhost` or its name ends in `_test`, so they can never touch your real Supabase data. Storage uploads and SMS are faked; nothing is uploaded or sent. The `prisma/migrations` folder (created during setup, including the appended safety constraints) must exist.

### What the database tests prove

**Double booking (court)**
- 10 people tap Book for the same hour at the same moment: exactly 1 succeeds, 9 are told it was just taken.
- Overlapping times (8–10 and 9–11) at the same moment: only one succeeds.
- Back-to-back bookings (8–10 then 10–11) are both allowed.
- Expired holds and cancelled bookings free the slot.
- Walk-ins and maintenance blocks can't overlap bookings, and the error names the booking in the way.
- The database refuses overlaps even if the app's own checks were skipped.

**Pool capacity**
- 10 groups of 4 at the same moment: exactly 7 fit (28 guests), 3 are told how many spots are left.
- Fills to exactly 30, then refuses the 31st guest. Online and walk-in bookings share the same 30.
- Expired holds, cancellations, no-shows and rejected payments give spots back, exactly once.
- Closed sessions take no bookings.

**Payments**
- Full flow: proof → waiting for staff (never expires) → approved → confirmed.
- Two staff approving at the same moment: confirmed once, one confirmation email.
- A GCash Ref. No. can't be reused; the duplicate screenshot is deleted.
- Wrong private link → not found. Non-image files refused.
- Paid after the hold expired: restored if still free; if taken, the payment is kept, the booking is flagged, and the other customer is untouched (court and pool).
- Rejection frees the slot and the email includes the reason.
- PayMongo: confirms the booking; the same webhook twice changes nothing; forged signatures refused; wrong amounts flagged.

**Owner and staff**
- Reschedule: fee carries over, balance recalculated, allowed once, conflicts named, 24-hour rule unless overridden, pool spots move between sessions.
- Check-in records the balance and only works on the booking day.
- New rates apply only to new bookings. Pool capacity can't drop below guests already booked.

**Scheduled job and reports**
- Reminders go out once (email + SMS) and not for last-minute bookings.
- Finished check-ins become completed. Screenshots are deleted after 90 days, recent ones kept.
- Report totals: money collected (cash vs GCash), booking value, day/night split, walk-ins.

### GitHub

If the project is on GitHub, `.github/workflows/test.yml` runs all tests and a production build on every push. Commit `package-lock.json` and the `prisma/migrations` folder for it to work.

## Checks to do by hand before going live

Use a real phone on mobile data.

**Customer**
- [ ] Booking page loads quickly; dates scroll; night hours look different.
- [ ] Tapping hours selects, extends and shrinks a block; price at the bottom is right (try 4–6 PM = ₱450).
- [ ] Pool: spots-left bar, adults/kids counters, kids-only blocked.
- [ ] Mistyped mobile/email show clear messages.
- [ ] Hold page: countdown, GCash details, copy buttons, QR image (if set).
- [ ] Upload a real GCash screenshot from the phone gallery (iPhone and Android).
- [ ] Confirmation email arrives (check spam), QR shows, booking link opens.
- [ ] Booking page shows the QR after confirmation.

**Staff (on the phone used at the counter)**
- [ ] Log in, approve a payment, reject one with a reason (customer gets the email).
- [ ] Scan a customer's QR at check-in (allow the camera when asked); collect the balance.
- [ ] Walk-in: price shown matches what you charge; slot disappears from the public page.
- [ ] Staff account can't open Reports/Settings.

**Owner**
- [ ] Change a rate, check the public page shows it; change it back.
- [ ] Block an hour; it shows as closed to customers. Remove it.
- [ ] Reports and the Excel download open correctly.
- [ ] Send test email works; staff alert email arrives when a proof is submitted.
- [ ] cron-job.org shows successful runs every 10 minutes; a reminder arrives 2 hours before a test booking.
