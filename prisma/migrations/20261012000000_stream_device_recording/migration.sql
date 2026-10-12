-- Seller-phone HD recording uploaded after the live; LiveKit egress stays as fallback.
DO $$ BEGIN
  CREATE TYPE "DeviceRecordingStatus" AS ENUM ('NONE', 'RECORDING', 'PENDING_UPLOAD', 'UPLOADING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StreamReplaySource" AS ENUM ('EGRESS', 'DEVICE', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Stream"
  ADD COLUMN IF NOT EXISTS "replaySource" "StreamReplaySource",
  ADD COLUMN IF NOT EXISTS "deviceRecordingStatus" "DeviceRecordingStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "deviceRecordingObjectKey" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceRecordingBytes" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deviceRecordingError" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceRecordingUpdatedAt" TIMESTAMP(3);

UPDATE "Stream" SET "replaySource" = 'ADMIN'
WHERE "isAdminUploaded" = true AND "replaySource" IS NULL;

UPDATE "Stream" SET "replaySource" = 'EGRESS'
WHERE "isAdminUploaded" = false AND "replayUrl" IS NOT NULL AND "replaySource" IS NULL;
