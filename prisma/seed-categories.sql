-- Dummy data for "Category" table (PostgreSQL)
-- Run with: psql $DATABASE_URL -f prisma/seed-categories.sql
-- Or in Render Shell / any client connected to your DB.

INSERT INTO "Category" (id, name, slug, "iconUrl", "parentId")
VALUES
  (gen_random_uuid(), 'Fashion', 'fashion', NULL, NULL),
  (gen_random_uuid(), 'Fashion & Apparel', 'fashion-apparel', NULL, NULL),
  (gen_random_uuid(), 'Beauty', 'beauty', NULL, NULL),
  (gen_random_uuid(), 'Handmade', 'handmade', NULL, NULL),
  (gen_random_uuid(), 'Art', 'art', NULL, NULL)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;
