-- Second pickleball court, and open play / scoreboard per court.
-- Safe to run on the live database: it only ADDS a court, columns and indexes.
-- (bookings_no_overlap already works per court, so two courts can be booked at the same time.)

-- 1. Court 2, starting with the same prices as Court 1 (the owner changes them in Settings).
INSERT INTO "amenities" ("id", "type", "name", "capacity", "is_active")
SELECT gen_random_uuid(), 'COURT', 'Pickleball Court 2', NULL, true
WHERE EXISTS (SELECT 1 FROM "amenities" WHERE "type" = 'COURT')  -- only on a database that already has Court 1
  AND NOT EXISTS (SELECT 1 FROM "amenities" WHERE "type" = 'COURT' AND "name" = 'Pickleball Court 2');

WITH c1 AS (
  SELECT "id" FROM "amenities" WHERE "type" = 'COURT' AND "name" <> 'Pickleball Court 2' ORDER BY "name" LIMIT 1
), c2 AS (
  SELECT "id" FROM "amenities" WHERE "type" = 'COURT' AND "name" = 'Pickleball Court 2' LIMIT 1
)
INSERT INTO "rate_rules" ("id", "amenity_id", "label", "start_minute", "end_minute", "price_centavos", "unit", "guest_type", "days_of_week", "is_active")
SELECT gen_random_uuid(), c2."id", r."label", r."start_minute", r."end_minute", r."price_centavos", r."unit", r."guest_type", r."days_of_week", true
FROM "rate_rules" r, c1, c2
WHERE r."amenity_id" = c1."id" AND r."is_active"
  AND NOT EXISTS (SELECT 1 FROM "rate_rules" x WHERE x."amenity_id" = c2."id");

-- 2. Which court an open play session uses (taken from its court block).
ALTER TABLE "open_play_sessions" ADD COLUMN "amenity_id" UUID;
UPDATE "open_play_sessions" s SET "amenity_id" = b."amenity_id"
FROM "bookings" b WHERE b."id" = s."block_booking_id";
UPDATE "open_play_sessions" SET "amenity_id" = (
  SELECT "id" FROM "amenities" WHERE "type" = 'COURT' AND "name" <> 'Pickleball Court 2' ORDER BY "name" LIMIT 1
) WHERE "amenity_id" IS NULL;
ALTER TABLE "open_play_sessions" ALTER COLUMN "amenity_id" SET NOT NULL;
ALTER TABLE "open_play_sessions" ADD CONSTRAINT "open_play_sessions_amenity_id_fkey"
  FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "open_play_sessions_amenity_id_idx" ON "open_play_sessions"("amenity_id");

-- 3. Which court a scored match is on. Existing matches were all on Court 1.
ALTER TABLE "matches" ADD COLUMN "amenity_id" UUID;
UPDATE "matches" m SET "amenity_id" = s."amenity_id"
FROM "open_play_sessions" s WHERE s."id" = m."open_play_session_id";
UPDATE "matches" SET "amenity_id" = (
  SELECT "id" FROM "amenities" WHERE "type" = 'COURT' AND "name" <> 'Pickleball Court 2' ORDER BY "name" LIMIT 1
) WHERE "amenity_id" IS NULL;
ALTER TABLE "matches" ALTER COLUMN "amenity_id" SET NOT NULL;
ALTER TABLE "matches" ADD CONSTRAINT "matches_amenity_id_fkey"
  FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "matches_amenity_id_idx" ON "matches"("amenity_id");

-- One live match per court (was: one live match in total).
DROP INDEX IF EXISTS "matches_one_live";
CREATE UNIQUE INDEX "matches_one_live_per_court" ON "matches" ("amenity_id") WHERE "status" = 'LIVE';
