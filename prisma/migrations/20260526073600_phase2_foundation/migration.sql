-- CreateEnum
CREATE TYPE "ReplacementStatus" AS ENUM ('REQUESTED', 'PENDING_ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "RatingEntityType" AS ENUM ('BUYER', 'SELLER');

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "commissionWaiverActive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "durationSeconds" INTEGER;

-- CreateTable
CREATE TABLE "BuyerRating" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "replacementCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerRating" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "originality" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "valueForMoney" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingOverrideLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "entityType" "RatingEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION NOT NULL,
    "newValue" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingOverrideLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "status" "ReplacementStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "photoUrls" TEXT[],
    "adminNote" TEXT,
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),
    "decidedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplacementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerSellerFollow" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSellerFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerLiveQualificationDay" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "qualified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SellerLiveQualificationDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamSession" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerRating_buyerId_key" ON "BuyerRating"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerRating_sellerId_key" ON "SellerRating"("sellerId");

-- CreateIndex
CREATE INDEX "RatingOverrideLog_entityType_entityId_idx" ON "RatingOverrideLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "RatingOverrideLog_adminUserId_createdAt_idx" ON "RatingOverrideLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplacementRequest_sellerId_createdAt_idx" ON "ReplacementRequest"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplacementRequest_buyerId_createdAt_idx" ON "ReplacementRequest"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplacementRequest_status_idx" ON "ReplacementRequest"("status");

-- CreateIndex
CREATE INDEX "ReplacementRequest_orderId_idx" ON "ReplacementRequest"("orderId");

-- CreateIndex
CREATE INDEX "BuyerSellerFollow_sellerId_idx" ON "BuyerSellerFollow"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerSellerFollow_buyerId_sellerId_key" ON "BuyerSellerFollow"("buyerId", "sellerId");

-- CreateIndex
CREATE INDEX "SellerLiveQualificationDay_sellerId_date_idx" ON "SellerLiveQualificationDay"("sellerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SellerLiveQualificationDay_sellerId_date_key" ON "SellerLiveQualificationDay"("sellerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StreamSession_streamId_key" ON "StreamSession"("streamId");

-- CreateIndex
CREATE INDEX "StreamSession_sellerId_endedAt_idx" ON "StreamSession"("sellerId", "endedAt");

-- AddForeignKey
ALTER TABLE "BuyerRating" ADD CONSTRAINT "BuyerRating_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerRating" ADD CONSTRAINT "SellerRating_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingOverrideLog" ADD CONSTRAINT "RatingOverrideLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerSellerFollow" ADD CONSTRAINT "BuyerSellerFollow_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerSellerFollow" ADD CONSTRAINT "BuyerSellerFollow_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLiveQualificationDay" ADD CONSTRAINT "SellerLiveQualificationDay_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
