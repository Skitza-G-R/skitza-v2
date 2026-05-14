-- Add an explicit `paid_at` timestamp column to the projects table.
-- Surface: Project Room → Overview tab "Key activity" timeline. Before
-- this column existed, the timeline rendered the "Paid" event using the
-- "latest activity" timestamp as a surrogate (most recent track upload
-- or comment), which was a hint, not a real signal. With paid_at we can
-- show the actual moment the project flipped to `stage='paid'`.
--
-- Stamping: project.setStage stamps NOW() when a project transitions
-- INTO stage='paid' if paid_at is null. Idempotent — re-calling setStage
-- with stage='paid' on a row that already has paid_at set does NOT
-- overwrite it. The Stripe webhook auto-flip path is intentionally
-- left alone here (Phase H's job to wire up).
--
-- Backfill: any project already in stage='paid' before this migration
-- runs gets paid_at = updated_at, so legacy timelines have something
-- to render. The column stays nullable — paid_at IS NULL is the
-- canonical "never been paid" signal.
--
-- Idempotent: safe to re-run; ADD COLUMN IF NOT EXISTS skips on a
-- second pass, and the UPDATE-with-NULL guard means the backfill never
-- overwrites an existing value.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "paid_at" timestamptz;

UPDATE "projects"
SET "paid_at" = "updated_at"
WHERE "stage" = 'paid' AND "paid_at" IS NULL;
