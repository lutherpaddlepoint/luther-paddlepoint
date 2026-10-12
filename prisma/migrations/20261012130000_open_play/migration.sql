-- Open play (paddle stacking)

-- CreateEnum
CREATE TYPE "open_play_status" AS ENUM ('SCHEDULED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "open_play_player_state" AS ENUM ('QUEUED', 'PLAYING', 'RESTING', 'OUT');

-- CreateTable
CREATE TABLE "open_play_sessions" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "rate_centavos_per_hour" INTEGER NOT NULL,
    "max_players" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "open_play_status" NOT NULL DEFAULT 'SCHEDULED',
    "block_booking_id" UUID,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_play_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_play_players" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "state" "open_play_player_state" NOT NULL DEFAULT 'QUEUED',
    "queue_pos" INTEGER NOT NULL,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_out_at" TIMESTAMPTZ(6),
    "hours_charged" INTEGER,
    "amount_centavos" INTEGER,
    "payment_method" "payment_method",
    "gcash_reference" TEXT,

    CONSTRAINT "open_play_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_play_sessions_block_booking_id_key" ON "open_play_sessions"("block_booking_id");

-- CreateIndex
CREATE INDEX "open_play_sessions_date_idx" ON "open_play_sessions"("date");

-- CreateIndex
CREATE INDEX "open_play_players_session_id_state_queue_pos_idx" ON "open_play_players"("session_id", "state", "queue_pos");

-- AddForeignKey
ALTER TABLE "open_play_players" ADD CONSTRAINT "open_play_players_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "open_play_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safety rules Prisma can't express
ALTER TABLE "open_play_sessions" ADD CONSTRAINT "open_play_sessions_values_check"
  CHECK ("end_minute" > "start_minute" AND "rate_centavos_per_hour" >= 0 AND "max_players" >= 4);
ALTER TABLE "open_play_players" ADD CONSTRAINT "open_play_players_amount_check"
  CHECK ("amount_centavos" IS NULL OR "amount_centavos" >= 0);

-- Keep the public Data API closed (same as npm run db:lockdown)
ALTER TABLE "open_play_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_play_players" ENABLE ROW LEVEL SECURITY;
