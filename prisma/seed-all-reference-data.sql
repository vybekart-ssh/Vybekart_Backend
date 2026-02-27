-- =============================================================================
-- Seed: Categories, Countries, States, FAQs (PostgreSQL)
-- Run: psql $DATABASE_URL -f prisma/seed-all-reference-data.sql
-- Or paste in Render Dashboard → Postgres → Shell / any SQL client.
--
-- APIs that use this data:
--   GET /categories          → Category
--   GET /countries           → Country
--   GET /countries/states?countryId=... → State (use country id from /countries)
--   (FAQs used by support/help; material-types & occasions are in-code, no DB)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Categories (for product/seller/stream spinners)
-- -----------------------------------------------------------------------------
INSERT INTO "Category" (id, name, slug, "iconUrl", "parentId")
VALUES
  (gen_random_uuid(), 'Fashion', 'fashion', NULL, NULL),
  (gen_random_uuid(), 'Fashion & Apparel', 'fashion-apparel', NULL, NULL),
  (gen_random_uuid(), 'Beauty', 'beauty', NULL, NULL),
  (gen_random_uuid(), 'Handmade', 'handmade', NULL, NULL),
  (gen_random_uuid(), 'Art', 'art', NULL, NULL)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

-- -----------------------------------------------------------------------------
-- 2. Countries (for address / country spinner)
-- -----------------------------------------------------------------------------
INSERT INTO "Country" (id, code, name)
VALUES
  (gen_random_uuid(), 'IN', 'India'),
  (gen_random_uuid(), 'US', 'United States'),
  (gen_random_uuid(), 'GB', 'United Kingdom'),
  (gen_random_uuid(), 'AE', 'United Arab Emirates'),
  (gen_random_uuid(), 'SG', 'Singapore')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- -----------------------------------------------------------------------------
-- 3. States (for address / state spinner – Indian states only; countryId from IN)
-- -----------------------------------------------------------------------------
INSERT INTO "State" (id, "countryId", code, name)
SELECT gen_random_uuid(), c.id, v.code, v.name
FROM (VALUES
  ('AN', 'Andaman and Nicobar Islands'),
  ('AP', 'Andhra Pradesh'),
  ('AR', 'Arunachal Pradesh'),
  ('AS', 'Assam'),
  ('BR', 'Bihar'),
  ('CH', 'Chandigarh'),
  ('CT', 'Chhattisgarh'),
  ('DN', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('DL', 'Delhi'),
  ('GA', 'Goa'),
  ('GJ', 'Gujarat'),
  ('HR', 'Haryana'),
  ('HP', 'Himachal Pradesh'),
  ('JK', 'Jammu and Kashmir'),
  ('JH', 'Jharkhand'),
  ('KA', 'Karnataka'),
  ('KL', 'Kerala'),
  ('LA', 'Ladakh'),
  ('LD', 'Lakshadweep'),
  ('MP', 'Madhya Pradesh'),
  ('MH', 'Maharashtra'),
  ('MN', 'Manipur'),
  ('ML', 'Meghalaya'),
  ('MZ', 'Mizoram'),
  ('NL', 'Nagaland'),
  ('OR', 'Odisha'),
  ('PY', 'Puducherry'),
  ('PB', 'Punjab'),
  ('RJ', 'Rajasthan'),
  ('SK', 'Sikkim'),
  ('TN', 'Tamil Nadu'),
  ('TG', 'Telangana'),
  ('TR', 'Tripura'),
  ('UP', 'Uttar Pradesh'),
  ('UT', 'Uttarakhand'),
  ('WB', 'West Bengal')
) AS v(code, name)
CROSS JOIN (SELECT id FROM "Country" WHERE code = 'IN' LIMIT 1) c
WHERE NOT EXISTS (
  SELECT 1 FROM "State" s WHERE s."countryId" = c.id AND s.code = v.code
);

-- -----------------------------------------------------------------------------
-- 4. FAQs (for support / help; run once or truncate "Faq" before re-run to avoid duplicates)
-- -----------------------------------------------------------------------------
INSERT INTO "Faq" (id, question, answer, "sortOrder")
SELECT gen_random_uuid(), v.question, v.answer, v."sortOrder"
FROM (VALUES
  ('How do I add a new product?', 'Go to Products tab and tap the + button. Fill in name, price, stock, and upload images.', 1),
  ('How do I schedule a live stream?', 'From the dashboard tap Schedule Live. Set title, date, time and add products to showcase.', 2),
  ('When do I receive my payouts?', 'Payouts are processed weekly to your registered bank account. Ensure bank details are correct in Payout Settings.', 3),
  ('How do I print shipping labels?', 'Open Orders, select the orders and tap Print Labels. Labels can be printed in bulk.', 4)
) AS v(question, answer, "sortOrder")
WHERE (SELECT COUNT(*) FROM "Faq") = 0;
