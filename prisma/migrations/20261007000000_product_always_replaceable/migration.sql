-- Every product is replaceable on Vybekart.
UPDATE "Product" SET "returnable" = true WHERE "returnable" IS DISTINCT FROM true;
ALTER TABLE "Product" ALTER COLUMN "returnable" SET DEFAULT true;
ALTER TABLE "Product" ALTER COLUMN "returnable" SET NOT NULL;
