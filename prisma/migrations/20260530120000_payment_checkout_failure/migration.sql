-- CreateTable
CREATE TABLE "PaymentCheckoutFailure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refundStatus" TEXT,
    "razorpayRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCheckoutFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCheckoutFailure_razorpayPaymentId_key" ON "PaymentCheckoutFailure"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "PaymentCheckoutFailure_userId_createdAt_idx" ON "PaymentCheckoutFailure"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCheckoutFailure_razorpayOrderId_idx" ON "PaymentCheckoutFailure"("razorpayOrderId");
