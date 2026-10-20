-- Announcement pushes sent from the admin console.
CREATE TABLE IF NOT EXISTS "AdminBroadcast" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminBroadcast_createdAt_idx" ON "AdminBroadcast"("createdAt");
