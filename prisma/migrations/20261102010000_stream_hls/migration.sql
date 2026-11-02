-- Adaptive (HLS) copy of archived lives. The original MP4 in "replayUrl" is never changed.
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "hlsUrl" TEXT;
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "hlsStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "hlsSource" TEXT;
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "hlsError" TEXT;
ALTER TABLE "Stream" ADD COLUMN IF NOT EXISTS "hlsUpdatedAt" TIMESTAMP(3);
