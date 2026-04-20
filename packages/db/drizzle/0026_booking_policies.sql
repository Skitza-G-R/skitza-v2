-- Batch B — Producer booking policies.
-- * auto_confirm_bookings: when true, new public bookings land in
--   `confirmed` state directly instead of `pending`. Saves the
--   producer a manual approval click per request — useful for
--   studios that already vet clients via their intake form.
-- * cancellation_policy_hours: the advance notice (in hours) an
--   artist must give to cancel. Stored for enforcement in the future
--   cancel-by-artist flow; surfaced in the booking confirmation email
--   and on the booking page copy today.
BEGIN;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "auto_confirm_bookings" boolean NOT NULL DEFAULT false;

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "cancellation_policy_hours" integer NOT NULL DEFAULT 24;

COMMIT;
