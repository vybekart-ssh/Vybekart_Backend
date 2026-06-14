-- CreateEnum
CREATE TYPE "BalancePaymentStatus" AS ENUM ('NONE', 'PENDING', 'PAID');

-- AlterEnum
ALTER TYPE "ReplacementStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
ALTER TYPE "ReplacementStatus" ADD VALUE IF NOT EXISTS 'PACKED';

-- AlterTable
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "replacementVariantId" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "replacementVariantLabel" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "originalUnitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "replacementUnitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "balanceDue" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "balancePaymentStatus" "BalancePaymentStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "razorpayOrderId" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "razorpayPaymentId" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "packingVideoUrl" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3);
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMP(3);
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "trackingId" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "carrierName" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "deliveryProvider" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "borzoTrackingUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ReplacementRequest_razorpayOrderId_key" ON "ReplacementRequest"("razorpayOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "ReplacementRequest_razorpayPaymentId_key" ON "ReplacementRequest"("razorpayPaymentId");
