-- AlterEnum (PACKED)
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PACKED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "streamId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packingVideoUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryMockShipmentId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_streamId_fkey'
  ) THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_streamId_fkey"
      FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
