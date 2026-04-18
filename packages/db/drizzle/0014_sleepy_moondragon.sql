-- Rename deals → projects (Task H.1, second rename — user feedback).
-- Uses ALTER TABLE ... RENAME / RENAME COLUMN so every row + index +
-- FK constraint is preserved. Postgres auto-updates dependent
-- constraint names under the hood.
BEGIN;

ALTER TABLE "deals" RENAME TO "projects";
ALTER TABLE "deal_tracks" RENAME TO "project_tracks";
ALTER TABLE "project_tracks" RENAME COLUMN "deal_id" TO "project_id";

-- Enum rename. References on columns are updated automatically.
ALTER TYPE "deal_stage" RENAME TO "project_stage";

-- FK columns on other tables that reference projects.
ALTER TABLE "bookings" RENAME COLUMN "deal_id" TO "project_id";
ALTER TABLE "contracts" RENAME COLUMN "deal_id" TO "project_id";
ALTER TABLE "notifications" RENAME COLUMN "deal_id" TO "project_id";

COMMIT;
