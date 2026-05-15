-- Phase 1 G7 — New Project modal fields.
-- Producers pick a store product, set a deadline, and snapshot the
-- engagement total + deposit at project-creation time. All four
-- columns are nullable so legacy rows and any existing callers of
-- project.create that don't pass these fields keep working unchanged.
-- DESIGN.md §6.2; plan: docs/plans/active/2026-05-15-...new-project-modal.md
--
-- product_id is SET NULL on delete: archiving a product preserves the
-- project row + the engagement_total_cents/deposit_cents snapshots so
-- historical bookings stay readable.
--
-- All four use ADD COLUMN IF NOT EXISTS — re-runnable / idempotent
-- per CLAUDE.md migration rules.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deadline_at" timestamp with time zone;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "engagement_total_cents" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deposit_cents" integer;
