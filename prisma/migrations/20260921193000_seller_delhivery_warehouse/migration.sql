-- Per-seller Delhivery warehouse sync fields (pickup_location.name).
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "delhiveryWarehouseName" TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "delhiveryWarehouseSyncedAt" TIMESTAMP(3);
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "delhiveryWarehouseLastError" TEXT;