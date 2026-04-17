-- Rollback script for migration 0024 (remote business function decoupling)
-- Run this BEFORE redeploying the dev branch to restore DB compatibility.
--
-- Usage:
--   psql "$SUPABASE_DB_URL" -f scripts/rollback-0024.sql

BEGIN;

-- Restore archived tables
ALTER TABLE "_archived_catalog_items" RENAME TO "catalog_items";
ALTER TABLE "_archived_catalogs" RENAME TO "catalogs";
ALTER TABLE "_archived_grass_pricing" RENAME TO "grass_pricing";

-- Restore archived columns on quotes
ALTER TABLE "quotes" RENAME COLUMN "_archived_surface_type" TO "surface_type";
ALTER TABLE "quotes" RENAME COLUMN "_archived_area_m2" TO "area_m2";
ALTER TABLE "quotes" RENAME COLUMN "_archived_perimeter_lm" TO "perimeter_lm";
ALTER TABLE "quotes" RENAME COLUMN "_archived_province" TO "province";

-- Remove migration 0024 entry so Drizzle doesn't think it's applied
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = '7f9700fb3253597a9f7372a724a1207fc27dcafbc25d6a7b8929a9e9a3486aa6';

-- Also remove migration 0023 (input_hash) — additive but keeps things clean
-- NOTE: the column+index stay, they don't break dev code
-- DELETE FROM drizzle.__drizzle_migrations
-- WHERE hash = '<0023_hash>';

COMMIT;
