-- Archive instead of DROP for safe rollback (see scripts/rollback-0024.sql)
ALTER TABLE "catalog_items" RENAME TO "_archived_catalog_items";--> statement-breakpoint
ALTER TABLE "catalogs" RENAME TO "_archived_catalogs";--> statement-breakpoint
ALTER TABLE "grass_pricing" RENAME TO "_archived_grass_pricing";--> statement-breakpoint
ALTER TABLE "quotes" RENAME COLUMN "surface_type" TO "_archived_surface_type";--> statement-breakpoint
ALTER TABLE "quotes" RENAME COLUMN "area_m2" TO "_archived_area_m2";--> statement-breakpoint
ALTER TABLE "quotes" RENAME COLUMN "perimeter_lm" TO "_archived_perimeter_lm";--> statement-breakpoint
ALTER TABLE "quotes" RENAME COLUMN "province" TO "_archived_province";