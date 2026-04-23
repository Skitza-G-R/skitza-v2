-- Audit Task 12 — Autopilot cron idempotency columns.
--
-- Context: the Autopilot cron route (/api/cron/autopilot) has had
-- 3 TODO branches since launch — unpaid-reminder, request-testimonial,
-- auto-archive. Wiring the first two safely requires timestamp
-- columns so the cron can skip rows it's already processed. Without
-- them, every tick would re-email the same producer about the same
-- invoice, or nag the same artist for the same testimonial.
--
-- Columns:
--   invoices.reminder_sent_at — NULL until the unpaid-reminder
--     sweep emails the producer about this invoice the first time.
--   projects.testimonial_requested_at — NULL until the
--     request-testimonial sweep emails the artist. (Emailing + form
--     capture is gated until the testimonial capture form ships;
--     column stubbed now so it exists when we wire the second half.)
--
-- Both columns are nullable; the sweep's WHERE clause keys off
-- `IS NULL` to identify targets.
--
-- Idempotent: both columns are ADD COLUMN IF NOT EXISTS. Safe to
-- re-run.

BEGIN;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone;

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "testimonial_requested_at" timestamp with time zone;

COMMIT;
