-- Configurable archive retention for live replays
ALTER TABLE "Stream"
ADD COLUMN IF NOT EXISTS "archiveRetentionHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN IF NOT EXISTS "archiveExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isAdminUploaded" BOOLEAN NOT NULL DEFAULT false;

-- Backfill timed expiry (24h from endedAt) for existing ended streams
UPDATE "Stream"
SET
  "archiveRetentionHours" = 24,
  "archiveExpiresAt" = "endedAt" + INTERVAL '24 hours'
WHERE "endedAt" IS NOT NULL
  AND "archiveExpiresAt" IS NULL;
