-- Batch B — Availability editor feature parity.
-- Producers set a default session length once (60 / 90 / 120 / 180 / 240
-- min or custom) instead of per-booking. Used as the fallback duration
-- when a product doesn't pin its own, and as the prefill for new
-- product creation.
BEGIN;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "default_session_min" integer NOT NULL DEFAULT 60;

COMMIT;
