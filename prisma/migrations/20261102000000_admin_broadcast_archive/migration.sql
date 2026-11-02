-- Optional live archive attached to an admin announcement (tap opens the replay in the app).
ALTER TABLE "AdminBroadcast" ADD COLUMN IF NOT EXISTS "archiveStreamId" TEXT;
ALTER TABLE "AdminBroadcast" ADD COLUMN IF NOT EXISTS "archiveTitle" TEXT;
