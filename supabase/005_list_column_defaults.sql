-- 005 · List columns default to an empty list instead of NULL
-- Rows created through the Supabase API left these lists NULL, which crashed pages
-- (e.g. Storefront: catalog items with no images). Safe to re-run.

BEGIN;

UPDATE "Organization" SET "capabilities" = '{}' WHERE "capabilities" IS NULL;
UPDATE "Plan"         SET "features"     = '{}' WHERE "features"     IS NULL;
UPDATE "AiAgent"      SET "enabledTools" = '{}' WHERE "enabledTools" IS NULL;
UPDATE "CatalogItem"  SET "images"       = '{}' WHERE "images"       IS NULL;
UPDATE "StaffMember"  SET "serviceIds"   = '{}' WHERE "serviceIds"   IS NULL;

ALTER TABLE "Organization" ALTER COLUMN "capabilities" SET DEFAULT '{}', ALTER COLUMN "capabilities" SET NOT NULL;
ALTER TABLE "Plan"         ALTER COLUMN "features"     SET DEFAULT '{}', ALTER COLUMN "features"     SET NOT NULL;
ALTER TABLE "AiAgent"      ALTER COLUMN "enabledTools" SET DEFAULT '{}', ALTER COLUMN "enabledTools" SET NOT NULL;
ALTER TABLE "CatalogItem"  ALTER COLUMN "images"       SET DEFAULT '{}', ALTER COLUMN "images"       SET NOT NULL;
ALTER TABLE "StaffMember"  ALTER COLUMN "serviceIds"   SET DEFAULT '{}', ALTER COLUMN "serviceIds"   SET NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
