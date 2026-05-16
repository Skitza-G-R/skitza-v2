-- Per-song pricing on the producer's project dashboard.
-- Add song_qty + unit_price_cents to projects so the project hero
-- can render "Mixing × 5 songs" alongside the engagement total
-- when an artist books a per-song product through /artist/store.
--
-- Both columns are nullable: flat-price projects (the entire backlog
-- of existing rows + every flat checkout) leave them NULL.
-- song_qty × unit_price_cents = total_amount_cents for per-song
-- rows; denormalised on purpose so the producer dashboard can render
-- "5 × $150 = $750" without re-running tier math against (possibly
-- mutated) product.volume_tiers.
--
-- Design: docs/plans/active/2026-05-16-per-song-pricing-design.md §3
-- Plan:   docs/plans/active/2026-05-16-per-song-pricing.md (Task 17)
--
-- ADD COLUMN IF NOT EXISTS keeps the migration idempotent per
-- CLAUDE.md rules — apply-migrations.mjs can re-run safely.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "song_qty" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "unit_price_cents" integer;
