-- Tranzila transaction confirmation number — captured from the
-- notify_url POST body (`ConfirmationCode` field) when a booking flips
-- to confirmed. Lets the success page render "Confirmation #..." back
-- to the artist. Nullable — Stripe-paid bookings won't have one.
--
-- Idempotent — safe to re-run via /skitza-migrate.
BEGIN;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "tranzila_confirmation_code" text;

COMMIT;
