-- CreateTable
CREATE TABLE "SellerChangeRequest" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "note" TEXT,
    "sections" TEXT[],
    "statusAtCreation" "VerificationStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerChangeRequest_sellerId_createdAt_idx" ON "SellerChangeRequest"("sellerId", "createdAt");

-- AddForeignKey
ALTER TABLE "SellerChangeRequest" ADD CONSTRAINT "SellerChangeRequest_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerChangeRequest" ADD CONSTRAINT "SellerChangeRequest_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

