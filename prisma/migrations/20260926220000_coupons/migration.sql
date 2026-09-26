-- CreateEnum
CREATE TYPE "CouponVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('FLAT', 'PERCENT');

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "CouponVisibility" NOT NULL,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxDiscountAmount" DOUBLE PRECISION,
    "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_redeemedOrderId_key" ON "Coupon"("redeemedOrderId");

-- CreateIndex
CREATE INDEX "Coupon_visibility_isActive_idx" ON "Coupon"("visibility", "isActive");

-- CreateIndex
CREATE INDEX "Coupon_isActive_redeemedAt_idx" ON "Coupon"("isActive", "redeemedAt");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "couponId" TEXT,
ADD COLUMN "couponCode" TEXT,
ADD COLUMN "couponDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;
