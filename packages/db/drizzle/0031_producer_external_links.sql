-- Story 04 of /join flow (Wave 2) — producer_external_links table.
--
-- Context (PRD §6.2, Section B): the `/join/<slug>` teaser shows TWO
-- audio sections. Section A is Skitza-uploaded tracks flagged public
-- (migration 0030). Section B is external streaming links — producer
-- pastes URLs from 7 supported platforms and they render as inline
-- embeds on the teaser page. These tracks are already public on their
-- origin platforms, so no gating.
--
-- Platform enum is fixed at 7 values. Adding a platform requires a
-- migration + embed component + Setup UI update — intentional friction
-- so the producer-facing platform list stays curated, not a free-form
-- URL bucket.
--
-- Order matters for render: `position` (integer) lets the producer
-- reorder on the Setup UI. Default 0 so new rows land at the top; the
-- app enforces unique positions within a producer via UPDATE on reorder.
--
-- Idempotent: enum creation wrapped in DO $$ ... $$ EXCEPTION block;
-- table + index use IF NOT EXISTS. Safe to re-run.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "external_platform" AS ENUM (
    'spotify',
    'apple_music',
    'youtube',
    'soundcloud',
    'bandcamp',
    'tidal',
    'instagram_reels'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "producer_external_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "platform" "external_platform" NOT NULL,
  "url" text NOT NULL,
  "title" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "producer_external_links_producer_idx"
  ON "producer_external_links" ("producer_id", "position");

COMMIT;
