-- Per-song pricing for storefront products.
-- songQty + unitPriceCents capture what the artist picked in the
-- pre-booking song-count stepper, so the producer dashboard can later
-- render "Mixing × 5 songs — $750" without re-running tier math.
--
-- Both columns are nullable: flat-price bookings (the current default
-- and the entire backlog of existing rows) leave them NULL. They are
-- only populated when the underlying product has pricingModel='per_song'.
--
-- Design: docs/plans/active/2026-05-16-per-song-pricing-design.md §3
-- Plan:   docs/plans/active/2026-05-16-per-song-pricing.md (Task 5)
--
-- ADD COLUMN IF NOT EXISTS keeps the migration idempotent per
-- CLAUDE.md rules — apply-migrations.mjs can re-run safely.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "song_qty" integer;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "unit_price_cents" integer;
