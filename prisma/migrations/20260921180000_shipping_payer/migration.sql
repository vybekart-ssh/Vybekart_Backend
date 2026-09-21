-- Shipping payer toggle (BUYER_PAYS | SELLER_PAYS). Default: seller pays.
DO $$ BEGIN
  CREATE TYPE "ShippingPayer" AS ENUM ('BUYER_PAYS', 'SELLER_PAYS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'SELLER_PAYS';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'SELLER_PAYS';