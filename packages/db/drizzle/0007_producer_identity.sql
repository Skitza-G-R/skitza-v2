-- Step 1 (Identity / "Your hall") fields for the May 2026 producer
-- onboarding redesign.
--
-- Adds two columns to `producers`:
--   * monogram_color — chosen swatch from the 6-gradient palette shown
--     on the Identity step (grad-amber/rose/emerald/violet/indigo/slate).
--     NOT NULL with default 'grad-amber' so existing producers and any
--     post-migration writes that omit the column resolve cleanly.
--   * tagline — short freeform line shown above the producer's
--     storefront on /join/<slug>. Nullable; the storefront falls back
--     to the producer's display name when null.
--
-- Idempotent — safe to re-run via /skitza-migrate.
BEGIN;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "monogram_color" text NOT NULL DEFAULT 'grad-amber';

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "tagline" text;

COMMIT;
