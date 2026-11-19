-- B8: one Razorpay payment may create several Orders (one per seller).
-- Drop uniqueness on the Razorpay ids and replace it with plain indexes.

-- DropIndex
DROP INDEX "Order_razorpayOrderId_key";

-- DropIndex
DROP INDEX "Order_razorpayPaymentId_key";

-- CreateIndex
CREATE INDEX "Order_razorpayOrderId_idx" ON "Order"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Order_razorpayPaymentId_idx" ON "Order"("razorpayPaymentId");
