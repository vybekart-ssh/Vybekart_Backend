-- AlterTable: add nullable name-part and gender columns to "User"
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "middleName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "gender" TEXT;

-- Backfill: naive split of the existing "name" display name.
-- - Single word -> firstName only.
-- - Two+ words -> first word => firstName, last word => lastName,
--   everything in between => middleName.
-- "gender" is intentionally left NULL (no reliable source to backfill from).
UPDATE "User"
SET
  "firstName" = CASE
    WHEN "name" IS NULL OR btrim("name") = '' THEN NULL
    ELSE split_part(btrim("name"), ' ', 1)
  END,
  "lastName" = CASE
    WHEN "name" IS NULL OR btrim("name") = '' THEN NULL
    WHEN array_length(regexp_split_to_array(btrim("name"), '\s+'), 1) >= 2
      THEN (regexp_split_to_array(btrim("name"), '\s+'))[array_length(regexp_split_to_array(btrim("name"), '\s+'), 1)]
    ELSE NULL
  END,
  "middleName" = CASE
    WHEN "name" IS NULL OR btrim("name") = '' THEN NULL
    WHEN array_length(regexp_split_to_array(btrim("name"), '\s+'), 1) >= 3
      THEN array_to_string(
        (regexp_split_to_array(btrim("name"), '\s+'))[2:array_length(regexp_split_to_array(btrim("name"), '\s+'), 1) - 1],
        ' '
      )
    ELSE NULL
  END
WHERE "firstName" IS NULL;
