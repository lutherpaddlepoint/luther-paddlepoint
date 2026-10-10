// Checks the safety rules from prisma/sql/constraints.sql are really in the database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./helpers";

after(() => prisma.$disconnect());

test("double-booking and capacity rules are installed", async () => {
  const rows = await prisma.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conname IN
    ('bookings_no_overlap', 'pool_inventory_capacity_check', 'payments_gcash_reference_unique', 'bookings_amounts_check')`;
  const names = rows.map((r) => r.conname).sort();
  assert.deepEqual(
    names,
    ["bookings_amounts_check", "bookings_no_overlap", "payments_gcash_reference_unique", "pool_inventory_capacity_check"],
    "Constraints missing. Run `npm run db:append-constraints` on the init migration before migrating.",
  );
});

test("hold-expiry and pool-reservation functions are installed", async () => {
  const rows = await prisma.$queryRaw<{ proname: string }[]>`SELECT proname FROM pg_proc WHERE proname IN ('expire_stale_holds', 'reserve_pool_spots')`;
  assert.equal(rows.length, 2);
});
