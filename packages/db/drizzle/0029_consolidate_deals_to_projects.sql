-- Consolidate the `deals` / `deal_tracks` tables into `projects` / `project_tracks`.
--
-- Backstory: migration 0008 renamed projects → deals. Migration 0014 was
-- supposed to rename back (deals → projects, deal_tracks → project_tracks)
-- but appears to have run against a DB in an inconsistent state where empty
-- projects + project_tracks shells already existed, so Postgres silently
-- refused the RENAME and neither of them errored out of the transaction
-- (the journal desync swallowed it). Result:
--   - `deals` (4 rows) held the real data + all payment_plan columns + stage
--   - `projects` (0 rows) was an empty phantom without `stage`
-- This blocked every dashboard load with `column "stage" of relation
-- "projects" does not exist` at runtime.
--
-- This migration:
--   1. If `deals` still exists (i.e. fix hasn't been applied yet), drops the
--      empty projects/project_tracks phantoms, renames deals → projects and
--      deal_tracks → project_tracks, renames the FK column.
--   2. Drops vestigial columns that schema.ts no longer declares.
--
-- Idempotent: all operations are guarded by existence checks or IF EXISTS,
-- so re-running against an already-consolidated DB is a safe no-op. Crucially
-- the rename steps only fire when `deals` still exists — otherwise running
-- twice would blow away the renamed `projects` table.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'deals') THEN
    -- `deals` still exists — we're on a pre-consolidation DB. Safe to drop
    -- the empty projects phantoms and rename.
    DROP TABLE IF EXISTS "project_tracks" CASCADE;
    DROP TABLE IF EXISTS "projects" CASCADE;

    ALTER TABLE "deals" RENAME TO "projects";
    ALTER TABLE "deal_tracks" RENAME TO "project_tracks";
    ALTER TABLE "project_tracks" RENAME COLUMN "deal_id" TO "project_id";
  END IF;
END $$;

-- Always-safe: drop vestigial columns that schema.ts no longer declares
-- (these persisted on `deals` because earlier `projects` migrations that
-- removed them ran against the phantom `projects` table, not `deals`).
ALTER TABLE "projects" DROP COLUMN IF EXISTS "client_name";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "client_email";
