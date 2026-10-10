-- CreateEnum
CREATE TYPE "role" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "amenity_type" AS ENUM ('COURT', 'POOL');

-- CreateEnum
CREATE TYPE "rate_unit" AS ENUM ('PER_HOUR', 'PER_PERSON');

-- CreateEnum
CREATE TYPE "guest_type" AS ENUM ('ADULT', 'KID');

-- CreateEnum
CREATE TYPE "booking_kind" AS ENUM ('BOOKING', 'BLOCK');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('HOLD', 'PENDING_VERIFICATION', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "booking_source" AS ENUM ('ONLINE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('RESERVATION_FEE', 'BALANCE');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('GCASH_MANUAL', 'GCASH_PAYMONGO', 'CASH');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "type" "amenity_type" NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_rules" (
    "id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "price_centavos" INTEGER NOT NULL,
    "unit" "rate_unit" NOT NULL,
    "guest_type" "guest_type",
    "days_of_week" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_sessions" (
    "id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pool_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_session_inventory" (
    "id" UUID NOT NULL,
    "pool_session_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "closed_reason" TEXT,

    CONSTRAINT "pool_session_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference_code" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "amenity_id" UUID NOT NULL,
    "kind" "booking_kind" NOT NULL DEFAULT 'BOOKING',
    "exclusive" BOOLEAN NOT NULL,
    "pool_inventory_id" UUID,
    "customer_name" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 0,
    "kids" INTEGER NOT NULL DEFAULT 0,
    "total_centavos" INTEGER NOT NULL DEFAULT 0,
    "reservation_fee_centavos" INTEGER NOT NULL DEFAULT 0,
    "balance_centavos" INTEGER NOT NULL DEFAULT 0,
    "status" "booking_status" NOT NULL,
    "source" "booking_source" NOT NULL DEFAULT 'ONLINE',
    "hold_expires_at" TIMESTAMPTZ(6),
    "agreed_to_policy_at" TIMESTAMPTZ(6),
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "rescheduled_from_id" UUID,
    "checked_in_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "attention_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_line_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_centavos" INTEGER NOT NULL,
    "amount_centavos" INTEGER NOT NULL,

    CONSTRAINT "booking_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "payment_type" NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_centavos" INTEGER NOT NULL,
    "gcash_reference" TEXT,
    "proof_image_path" TEXT,
    "provider_payment_id" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "verified_by" UUID,
    "rejection_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "booking_id" UUID,
    "event" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "rate_rules_amenity_id_is_active_idx" ON "rate_rules"("amenity_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "pool_session_inventory_pool_session_id_date_key" ON "pool_session_inventory"("pool_session_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_code_key" ON "bookings"("reference_code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_access_token_key" ON "bookings"("access_token");

-- CreateIndex
CREATE INDEX "bookings_amenity_id_start_at_idx" ON "bookings"("amenity_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "bookings_mobile_idx" ON "bookings"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_gcash_reference_idx" ON "payments"("gcash_reference");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_booking_id_idx" ON "notifications"("booking_id");

-- AddForeignKey
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_sessions" ADD CONSTRAINT "pool_sessions_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_session_inventory" ADD CONSTRAINT "pool_session_inventory_pool_session_id_fkey" FOREIGN KEY ("pool_session_id") REFERENCES "pool_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pool_inventory_id_fkey" FOREIGN KEY ("pool_inventory_id") REFERENCES "pool_session_inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;


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
