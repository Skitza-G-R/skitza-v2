-- 0013_track_versions_description.sql
-- Adds optional `description` column to track_versions to persist the
-- producer's notes typed in the Phase 4 Upload Track modal (DESIGN.md
-- §6.4). Nullable so existing rows are unaffected. Idempotent.

ALTER TABLE "track_versions" ADD COLUMN IF NOT EXISTS "description" text;
