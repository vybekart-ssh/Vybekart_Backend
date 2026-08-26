-- Product GST slab rules (master-configurable; used by seller Add Product).
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "productGstPriceThresholdInr" DOUBLE PRECISION NOT NULL DEFAULT 1000;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "productGstPercentBelow" DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "productGstPercentAtOrAbove" DOUBLE PRECISION NOT NULL DEFAULT 12;
