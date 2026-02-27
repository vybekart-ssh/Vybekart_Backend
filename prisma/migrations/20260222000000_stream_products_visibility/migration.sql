-- CreateEnum
CREATE TYPE "StreamVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS_ONLY');

-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "visibility" "StreamVisibility" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "StreamProduct" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamProduct_streamId_productId_key" ON "StreamProduct"("streamId", "productId");

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamProduct" ADD CONSTRAINT "StreamProduct_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamProduct" ADD CONSTRAINT "StreamProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
