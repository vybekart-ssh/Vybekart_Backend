-- Explore promotional YouTube videos (Master Console curated).
CREATE TABLE "PromoVideo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "youtubeUrl" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoVideo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromoVideo_isActive_sortOrder_idx" ON "PromoVideo"("isActive", "sortOrder");
