-- SK-280: extend the producer's window to answer a held booking request from
-- 24 hours to 48 hours. The bookings_held_expiry_shape CHECK pins the exact
-- expiry instant, so the application's new 48h writes would violate the old
-- constraint — this migration MUST be applied before the 48h code deploys.
-- Existing rows keep their already-stamped expiry instants: rows written
-- under the 24h rule satisfy neither LEAST() expression retroactively, so the
-- rewritten CHECK also accepts the historical 24h shape.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_held_expiry_shape";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_held_expiry_shape" CHECK ((
  ("status" <> 'pending_approval' OR "held_expires_at" IS NOT NULL)
  AND (
    "held_expires_at" IS NULL
    OR "held_expires_at" = LEAST("created_at" + interval '48 hours', "starts_at")
    OR "held_expires_at" = LEAST("created_at" + interval '24 hours', "starts_at")
  )
  AND (
    ("held_expired_at" IS NULL AND "held_expiry_reason" IS NULL)
    OR (
      "held_expired_at" IS NOT NULL
      AND "held_expiry_reason" = 'approval_timeout'
      AND "held_expires_at" IS NOT NULL
      AND "held_expired_at" >= "held_expires_at"
      AND "status" = 'cancelled'
      AND "outcome" = 'cancelled_by_producer'
    )
  )
));
