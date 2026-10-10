
-- ============================================================================
-- Luther PaddlePoint & Pool — database-level safety rules
-- Appended to the init migration by scripts/append-constraints.mjs
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. NO DOUBLE BOOKING (court, court blocks, private pool rentals)
--    Two "exclusive" bookings for the same amenity can never overlap while
--    active. Enforced by PostgreSQL itself, so simultaneous requests are safe.
--    [) range = end time is open, so 4–5 PM and 5–6 PM do not conflict.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "amenity_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (
    "exclusive"
    AND "status" IN ('HOLD', 'PENDING_VERIFICATION', 'CONFIRMED', 'CHECKED_IN')
  );

-- ---------------------------------------------------------------------------
-- 2. POOL CAPACITY can never go above the limit or below zero
-- ---------------------------------------------------------------------------
ALTER TABLE "pool_session_inventory"
  ADD CONSTRAINT "pool_inventory_capacity_check"
  CHECK ("reserved" >= 0 AND "reserved" <= "capacity" AND "capacity" >= 0);

-- ---------------------------------------------------------------------------
-- 3. Basic sanity checks on bookings and money
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_order_check" CHECK ("end_at" > "start_at"),
  ADD CONSTRAINT "bookings_guest_count_check" CHECK ("adults" >= 0 AND "kids" >= 0),
  ADD CONSTRAINT "bookings_amounts_check" CHECK (
    "total_centavos" >= 0
    AND "reservation_fee_centavos" >= 0
    AND "balance_centavos" >= 0
    AND "reservation_fee_centavos" + "balance_centavos" = "total_centavos"
  ),
  ADD CONSTRAINT "bookings_hold_has_expiry_check" CHECK (
    "status" <> 'HOLD' OR "hold_expires_at" IS NOT NULL
  ),
  ADD CONSTRAINT "bookings_reschedule_limit_check" CHECK ("reschedule_count" BETWEEN 0 AND 1);

ALTER TABLE "rate_rules"
  ADD CONSTRAINT "rate_rules_minutes_check" CHECK (
    "start_minute" >= 0 AND "end_minute" <= 1440 AND "end_minute" > "start_minute"
  ),
  ADD CONSTRAINT "rate_rules_price_check" CHECK ("price_centavos" >= 0);

ALTER TABLE "pool_sessions"
  ADD CONSTRAINT "pool_sessions_minutes_check" CHECK (
    "start_minute" >= 0 AND "end_minute" <= 1440 AND "end_minute" > "start_minute"
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount_centavos" > 0);

-- The same GCash reference number cannot be submitted for two bookings
-- (stops customers reusing an old screenshot). Rejected proofs don't count.
-- (Written as an exclusion constraint instead of a partial unique index so that
-- future Prisma migrations don't try to drop it.)
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_gcash_reference_unique"
  EXCLUDE USING btree ("gcash_reference" WITH =)
  WHERE ("gcash_reference" IS NOT NULL AND "status" <> 'REJECTED');

-- ---------------------------------------------------------------------------
-- 4. EXPIRE STALE HOLDS
--    Called at the start of every availability check and booking attempt
--    (Vercel's free plan can't run frequent cron jobs). Marks unpaid holds as
--    EXPIRED and gives their pool slots back, in one atomic statement.
--    Only HOLD expires; PENDING_VERIFICATION waits for staff to approve/reject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_stale_holds() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  expired_count integer;
BEGIN
  WITH expired AS (
    UPDATE "bookings"
       SET "status" = 'EXPIRED', "updated_at" = now()
     WHERE "status" = 'HOLD'
       AND "hold_expires_at" < now()
    RETURNING "pool_inventory_id", ("adults" + "kids") AS guests
  ),
  totals AS (
    SELECT "pool_inventory_id", SUM(guests)::int AS guests
      FROM expired
     WHERE "pool_inventory_id" IS NOT NULL
     GROUP BY "pool_inventory_id"
  ),
  released AS (
    UPDATE "pool_session_inventory" i
       SET "reserved" = i."reserved" - t.guests
      FROM totals t
     WHERE i."id" = t."pool_inventory_id"
    RETURNING 1
  )
  SELECT COUNT(*) INTO expired_count FROM expired;

  RETURN expired_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RESERVE POOL SPOTS atomically
--    Returns the new reserved count, or NULL if the session is full/closed.
--    Usage: SELECT reserve_pool_spots('<inventory_id>', 4);
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_pool_spots(p_inventory_id uuid, p_guests integer)
RETURNS integer
LANGUAGE sql AS $$
  UPDATE "pool_session_inventory"
     SET "reserved" = "reserved" + p_guests
   WHERE "id" = p_inventory_id
     AND NOT "is_closed"
     AND "reserved" + p_guests <= "capacity"
  RETURNING "reserved";
$$;
