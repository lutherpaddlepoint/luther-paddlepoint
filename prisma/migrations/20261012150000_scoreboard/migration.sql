-- Scoreboard (referee scoring, results, leaderboard)

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('LIVE', 'FINISHED', 'ABANDONED');

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "open_play_session_id" UUID,
    "team_a" TEXT[],
    "team_b" TEXT[],
    "team_a_player_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "team_b_player_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target" INTEGER NOT NULL,
    "score_a" INTEGER NOT NULL DEFAULT 0,
    "score_b" INTEGER NOT NULL DEFAULT 0,
    "serving" TEXT NOT NULL DEFAULT 'A',
    "server" INTEGER NOT NULL DEFAULT 2,
    "rallies" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "status" "match_status" NOT NULL DEFAULT 'LIVE',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matches_status_idx" ON "matches"("status");

-- CreateIndex
CREATE INDEX "matches_open_play_session_id_idx" ON "matches"("open_play_session_id");

-- CreateIndex
CREATE INDEX "matches_finished_at_idx" ON "matches"("finished_at");

-- Safety rules Prisma can't express
ALTER TABLE "matches" ADD CONSTRAINT "matches_values_check" CHECK (
  "target" IN (11, 15, 21) AND "serving" IN ('A', 'B') AND "server" IN (1, 2)
  AND ("winner" IS NULL OR "winner" IN ('A', 'B')) AND "score_a" >= 0 AND "score_b" >= 0
);
-- One court: only one live match at a time
CREATE UNIQUE INDEX "matches_one_live" ON "matches" (("status")) WHERE "status" = 'LIVE';

-- Keep the public Data API closed (same as npm run db:lockdown)
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;
