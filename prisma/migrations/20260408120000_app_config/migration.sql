-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "minAndroidVersionCode" INTEGER NOT NULL DEFAULT 1,
    "latestAndroidVersionName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppConfig" ("id", "minAndroidVersionCode", "latestAndroidVersionName", "updatedAt")
VALUES ('global', 1, '1.0', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
