-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OUT_OF_STOCK');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "material" TEXT,
ADD COLUMN     "suitableForOccasion" TEXT,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "mrp" DOUBLE PRECISION,
ADD COLUMN     "discountPercent" DOUBLE PRECISION,
ADD COLUMN     "priceType" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "gstPercent" DOUBLE PRECISION,
ADD COLUMN     "weightKg" DOUBLE PRECISION,
ADD COLUMN     "lengthCm" DOUBLE PRECISION,
ADD COLUMN     "widthCm" DOUBLE PRECISION,
ADD COLUMN     "heightCm" DOUBLE PRECISION,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "returnable" BOOLEAN DEFAULT true,
ADD COLUMN     "refundType" TEXT,
ADD COLUMN     "returnWindowDays" INTEGER,
ADD COLUMN     "variants" JSONB;
