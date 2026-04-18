-- Phase H.4c — reminder dispatch markers on bookings.
-- Two nullable timestamps so /api/cron/session-reminders can pick up
-- bookings that haven't yet been reminded for the 24h or 1h window
-- without scheduling external jobs. NULL means "not yet sent"; we
-- stamp NOW() after a successful Resend send. Idempotency comes from
-- IS NULL in the cron SELECT.
BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_sent_24h" timestamp with time zone;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_sent_1h" timestamp with time zone;

COMMIT;
