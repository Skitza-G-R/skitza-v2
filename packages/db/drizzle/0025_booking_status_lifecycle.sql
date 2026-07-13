-- SK-79 — align the persisted booking lifecycle with the current schema.
--
-- The original v3 enum used `pending` for bookings awaiting producer
-- approval. Current code names that state `pending_approval` and adds a
-- separate `pending_payment` state. Keep the legacy label in the enum for
-- PostgreSQL compatibility, but move every legacy row to its lossless modern
-- equivalent and make new rows default there.

ALTER TYPE "public"."booking_status"
  ADD VALUE IF NOT EXISTS 'pending_approval' BEFORE 'confirmed';

ALTER TYPE "public"."booking_status"
  ADD VALUE IF NOT EXISTS 'pending_payment' BEFORE 'confirmed';

ALTER TABLE "bookings"
  ALTER COLUMN "status" SET DEFAULT 'pending_approval';

UPDATE "bookings"
SET "status" = 'pending_approval'
WHERE "status"::text = 'pending';
