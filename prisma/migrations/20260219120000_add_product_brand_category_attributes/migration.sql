-- AlterTable: optional brand + category-specific attributes (migration-safe, nullable)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "categoryAttributes" JSONB;
