-- Story 01 of /join flow — `is_public_sample` toggle on portfolio tracks.
--
-- Context (PRD §6.2): `skitza.app/join/<slug>` shows unsigned-in visitors
-- up to 3 producer-curated tracks. Each portfolio track carries an
-- `is_public_sample` flag; only tracks with the flag `true` play in the
-- teaser. Default is `false` — existing rows are opt-in per track.
--
-- The partial index keeps the per-producer "give me my public samples"
-- lookup on `/join/<slug>` fast even as portfolios grow: it indexes
-- only rows where `is_public_sample = true`, so each producer's three
-- flagged tracks are found without scanning their whole tracklist.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
-- Safe to re-run via `/skitza-migrate` on a partially-migrated DB.
BEGIN;

ALTER TABLE "portfolio_tracks"
  ADD COLUMN IF NOT EXISTS "is_public_sample" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "portfolio_tracks_public_sample_idx"
  ON "portfolio_tracks" ("producer_id", "is_public_sample")
  WHERE "is_public_sample" = true;

COMMIT;
