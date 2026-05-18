-- 0020_bookings_producer_acknowledged_at.sql
--
-- SK-20 — producer payment-received banner. Nullable timestamptz that
-- the producer stamps when they dismiss the in-app "you got paid"
-- banner for a confirmed booking. NULL = not yet acknowledged (banner
-- still shows + activity feed marks the payment row unread); non-NULL
-- = producer has seen and dismissed it.
--
-- Mirrors the precedent set by `reminder_sent_24h` / `reminder_sent_1h`
-- on the same table: a nullable timestamp is more useful than a
-- boolean because it gives us "when" for free (telemetry, audit, age
-- caps on the banner query).

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "producer_acknowledged_at" timestamp with time zone;
