-- Likes, comments and bids move from Redis (48h TTL) to Postgres so archives keep them forever.
CREATE TABLE IF NOT EXISTS "StreamLike" (
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamLike_pkey" PRIMARY KEY ("streamId", "userId")
);

CREATE TABLE IF NOT EXISTS "StreamComment" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isSeller" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StreamBid" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StreamBid_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StreamComment_streamId_createdAt_idx" ON "StreamComment"("streamId", "createdAt");
CREATE INDEX IF NOT EXISTS "StreamBid_streamId_createdAt_idx" ON "StreamBid"("streamId", "createdAt");

ALTER TABLE "StreamLike" ADD CONSTRAINT "StreamLike_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamComment" ADD CONSTRAINT "StreamComment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamBid" ADD CONSTRAINT "StreamBid_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
