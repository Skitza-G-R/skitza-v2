-- Marketing-grade meta fields shown on the public /join/<slug> page's
-- 4-stat band (Genres / Released / Streams / Response).
--
-- Per design intent: these are CURATED freeform strings the producer
-- fills in via Settings, NOT computed from real bookings/streams data.
-- Phase H is where Spotify/SoundCloud OAuth + real-streams analytics
-- live; this migration deliberately stays in the freeform-text lane.
--
-- Each column is nullable so:
--   1. Existing rows don't need backfill — a producer who never opens
--      Settings keeps showing the static defaults the React component
--      already supplies.
--   2. The /join meta-strip can hide a stat when its value is null,
--      because an empty stat block is worse than a missing one.
--
-- Idempotent — safe to re-run via `/skitza-migrate`.
BEGIN;

ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "genres" text[];
ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "released_summary" text;
ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "streams_summary" text;
ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "response_hours" integer;

COMMIT;
