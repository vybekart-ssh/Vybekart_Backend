-- Live stream archives are kept forever; nothing expires automatically.
UPDATE "Stream" SET "archiveRetentionHours" = -1, "archiveExpiresAt" = NULL
WHERE "archiveRetentionHours" <> -1 OR "archiveExpiresAt" IS NOT NULL;
ALTER TABLE "Stream" ALTER COLUMN "archiveRetentionHours" SET DEFAULT -1;
