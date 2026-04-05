-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "goLiveReminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserPushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPushDevice_fcmToken_key" ON "UserPushDevice"("fcmToken");

-- CreateIndex
CREATE INDEX "UserPushDevice_userId_idx" ON "UserPushDevice"("userId");

-- AddForeignKey
ALTER TABLE "UserPushDevice" ADD CONSTRAINT "UserPushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
