-- G.11 — Stems-requested automation on track approval.
-- Producers mark a track version "final / approved". The presence of a
-- timestamp in `approved_at` is the flag; null means unapproved. The
-- router (`deal.approveVersion`) sets this column and emits a
-- `track_approved` notification ("don't forget to send the stems").
-- Pure additive migration: one ADD COLUMN, nullable, no default.
BEGIN;

ALTER TABLE "track_versions" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;

COMMIT;
