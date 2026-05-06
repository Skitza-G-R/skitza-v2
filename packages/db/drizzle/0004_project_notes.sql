-- Add a producer-only private notes column to projects.
-- Surface: Project Room → Notes tab. Free-text, nullable, capped at
-- 5000 chars at the procedure layer (column itself is unbounded `text`).
-- Idempotent: safe to re-run; column will be added once and skipped on
-- subsequent invocations.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "notes" text;
