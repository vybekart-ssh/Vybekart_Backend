-- Delhivery delivery estimate shown to buyer and seller.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "expectedDeliveryAt" TIMESTAMP(3);
