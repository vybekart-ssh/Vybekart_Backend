ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "ReplacementRequest" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_invoiceNumber_key" ON "Order"("invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ReplacementRequest_invoiceNumber_key" ON "ReplacementRequest"("invoiceNumber");
