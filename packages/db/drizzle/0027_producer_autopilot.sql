-- Batch G — Autopilot toggles.
-- Five boolean columns on `producers` that drive Skitza's
-- "auto-pilot" behaviors. The design principle: no rule-builder UI,
-- no if/then/else, no named conditions — just five named outcomes
-- the producer flips on or off. Each column is a behavior label.
--
-- * autopilot_welcome_email: when a booking lands (via
--   producer.confirm or the auto-confirm path), send the artist a
--   confirmation email with session details.
-- * autopilot_unpaid_reminder: nudge the producer when an invoice
--   has been unpaid for 7+ days. Cron-driven (daily).
-- * autopilot_request_testimonial: ask the artist for a testimonial
--   once a project reaches the 'paid' stage.
-- * autopilot_comment_notify: create a notifications row for the
--   producer when an artist posts a comment on a track version.
--   Default ON — this matches the existing unconditional behavior,
--   so flipping the flag only takes effect on NEW producers who
--   choose to disable it.
-- * autopilot_auto_archive: 30 days after final payment lands, move
--   the project to the 'archived' stage automatically.
--
-- All five default to sensible values; existing producer rows are
-- unaffected because Postgres NOT NULL DEFAULT fills in the default.
-- Idempotent via IF NOT EXISTS so re-runs in a dev loop are safe.
BEGIN;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "autopilot_welcome_email" boolean NOT NULL DEFAULT false;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "autopilot_unpaid_reminder" boolean NOT NULL DEFAULT false;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "autopilot_request_testimonial" boolean NOT NULL DEFAULT false;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "autopilot_comment_notify" boolean NOT NULL DEFAULT true;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "autopilot_auto_archive" boolean NOT NULL DEFAULT false;

COMMIT;
