-- SK-153: global artist preferences, artist-owned notifications, and
-- immutable read-only access captured when an artist disconnects.

CREATE TYPE "artist_notification_kind" AS ENUM (
  'purchase_approved',
  'purchase_declined',
  'proof_verified',
  'proof_rejected',
  'booking_confirmed',
  'booking_declined',
  'booking_changed',
  'booking_cancelled',
  'session_reminder_24h',
  'session_reminder_1h',
  'track_version_created',
  'producer_comment_created'
);

CREATE TYPE "artist_notification_subject_type" AS ENUM (
  'purchase_request',
  'payment_proof',
  'booking',
  'track_version'
);

CREATE TYPE "artist_historical_resource_type" AS ENUM (
  'studio',
  'purchase',
  'project',
  'track',
  'track_version',
  'track_comment',
  'payment_proof',
  'booking',
  'track_version_download'
);

CREATE TABLE "artist_profiles" (
  "clerk_user_id" text PRIMARY KEY,
  "timezone" text,
  "notification_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "artist_profiles_identity_shape"
    CHECK ("clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  CONSTRAINT "artist_profiles_timezone_shape"
    CHECK (
      "timezone" IS NULL
      OR (
        "timezone" = btrim("timezone")
        AND char_length("timezone") BETWEEN 1 AND 100
      )
    ),
  CONSTRAINT "artist_profiles_timestamp_shape"
    CHECK ("updated_at" >= "created_at")
);

CREATE TABLE "artist_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recipient_clerk_user_id" text NOT NULL,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE RESTRICT,
  "kind" "artist_notification_kind" NOT NULL,
  "subject_type" "artist_notification_subject_type" NOT NULL,
  "subject_id" uuid NOT NULL,
  "destination_href" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "dedupe_key" text NOT NULL,
  "in_app_visible" boolean NOT NULL DEFAULT true,
  "switcher_dot_worthy" boolean NOT NULL DEFAULT false,
  "read_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "artist_notifications_recipient_dedupe_unique"
    UNIQUE ("recipient_clerk_user_id", "dedupe_key"),
  CONSTRAINT "artist_notifications_identity_shape"
    CHECK (
      "recipient_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND NULLIF(btrim("dedupe_key"), '') IS NOT NULL
      AND char_length("dedupe_key") <= 255
    ),
  CONSTRAINT "artist_notifications_destination_shape"
    CHECK (
      char_length("destination_href") BETWEEN 1 AND 512
      AND "destination_href" LIKE '/artist/%'
      AND "destination_href" NOT LIKE '//%'
      AND position(chr(92) in "destination_href") = 0
      AND position('://' in "destination_href") = 0
    ),
  CONSTRAINT "artist_notifications_timestamp_shape"
    CHECK (
      ("read_at" IS NULL OR "read_at" >= "created_at")
      AND ("opened_at" IS NULL OR "opened_at" >= "created_at")
    )
);

CREATE INDEX "artist_notifications_recipient_feed_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "in_app_visible",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "artist_notifications_recipient_unread_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "created_at" DESC,
    "id" DESC
  )
  WHERE "in_app_visible" IS TRUE AND "read_at" IS NULL;

CREATE INDEX "artist_notifications_recipient_studio_dot_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "producer_id",
    "created_at" DESC,
    "id" DESC
  )
  WHERE "switcher_dot_worthy" IS TRUE AND "opened_at" IS NULL;

CREATE TABLE "artist_historical_access_grants" (
  "artist_clerk_user_id" text NOT NULL,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE RESTRICT,
  "resource_type" "artist_historical_resource_type" NOT NULL,
  "resource_id" uuid NOT NULL,
  "disconnected_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "artist_historical_access_grants_pk"
    PRIMARY KEY (
      "artist_clerk_user_id",
      "producer_id",
      "resource_type",
      "resource_id"
    ),
  CONSTRAINT "artist_historical_access_grants_identity_shape"
    CHECK ("artist_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  CONSTRAINT "artist_historical_access_grants_timestamp_shape"
    CHECK ("created_at" >= "disconnected_at")
);

CREATE INDEX "artist_historical_access_grants_artist_studio_idx"
  ON "artist_historical_access_grants" (
    "artist_clerk_user_id",
    "producer_id",
    "resource_type"
  );

CREATE INDEX "artist_historical_access_grants_artist_resource_idx"
  ON "artist_historical_access_grants" (
    "artist_clerk_user_id",
    "resource_type",
    "resource_id"
  );

CREATE TRIGGER "artist_historical_access_grants_append_only"
  BEFORE UPDATE OR DELETE ON "artist_historical_access_grants"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Explicit artist-booking eligibility. Duration and session count alone must
-- never make a product bookable. Existing products intentionally remain false.
ALTER TABLE "products"
  ADD COLUMN "booking_enabled" boolean NOT NULL DEFAULT false;

-- Accepted allowance eligibility is separately snapshotted. The only legacy
-- compatibility path is an allowance with an immutable prior confirmation
-- event; all other pre-SK-153 allowances remain non-bookable.
ALTER TABLE "purchase_session_allowances"
  ADD COLUMN "booking_enabled_snapshot" boolean NOT NULL DEFAULT false;

UPDATE "purchase_session_allowances" AS "allowance"
SET "booking_enabled_snapshot" = true
WHERE EXISTS (
  SELECT 1
  FROM "bookings" AS "booking"
  INNER JOIN "booking_transition_events" AS "event"
    ON "event"."booking_id" = "booking"."id"
   AND "event"."producer_id" = "booking"."producer_id"
  WHERE "booking"."session_allowance_id" = "allowance"."id"
    AND "booking"."producer_id" = "allowance"."producer_id"
    AND "event"."to_status" = 'confirmed'
);

-- Migration 0027 already owns this trigger. Replace it deliberately so this
-- migration cannot collide with the existing trigger name while extending the
-- same guard with the accepted booking-eligibility snapshot.
DROP TRIGGER IF EXISTS "purchase_session_allowances_protect_terms"
  ON "purchase_session_allowances";

CREATE OR REPLACE FUNCTION "protect_session_allowance_terms"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_DELETE_FORBIDDEN';
  END IF;
  IF ROW(
    OLD."id", OLD."purchase_id", OLD."producer_id",
    OLD."booking_enabled_snapshot", OLD."kind", OLD."session_limit",
    OLD."duration_min", OLD."location_type", OLD."buffer_minutes",
    OLD."min_lead_hours", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."purchase_id", NEW."producer_id",
    NEW."booking_enabled_snapshot", NEW."kind", NEW."session_limit",
    NEW."duration_min", NEW."location_type", NEW."buffer_minutes",
    NEW."min_lead_hours", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_TERMS_IMMUTABLE';
  END IF;
  IF OLD."closed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_CLOSURE_IMMUTABLE';
  END IF;
  IF NEW."closed_at" IS NULL AND NEW."close_reason" IS NOT NULL THEN
    RAISE EXCEPTION 'SKITZA_SESSION_ALLOWANCE_CLOSE_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_session_allowances_protect_terms"
  BEFORE UPDATE OR DELETE ON "purchase_session_allowances"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_session_allowance_terms"();

CREATE TYPE "booking_held_expiry_reason" AS ENUM ('approval_timeout');

ALTER TABLE "bookings"
  ADD COLUMN "allowance_use_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "cancellation_policy_hours_snapshot" integer,
  ADD COLUMN "cancellation_policy_snapshotted_at" timestamp with time zone,
  ADD COLUMN "cancellation_policy_backfilled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "held_expires_at" timestamp with time zone,
  ADD COLUMN "held_expired_at" timestamp with time zone,
  ADD COLUMN "held_expiry_reason" "booking_held_expiry_reason";

-- Existing reschedule chains inherit the root booking's allowance-use identity.
-- New replacements copy this identity in the application transaction.
WITH RECURSIVE "booking_roots" AS (
  SELECT "id", "id" AS "root_id"
  FROM "bookings"
  WHERE "rescheduled_from_booking_id" IS NULL

  UNION ALL

  SELECT "child"."id", "parent"."root_id"
  FROM "bookings" AS "child"
  INNER JOIN "booking_roots" AS "parent"
    ON "child"."rescheduled_from_booking_id" = "parent"."id"
)
UPDATE "bookings" AS "booking"
SET "allowance_use_id" = "root"."allowance_use_id"
FROM "booking_roots" AS "chain"
INNER JOIN "bookings" AS "root"
  ON "root"."id" = "chain"."root_id"
WHERE "booking"."id" = "chain"."id";

-- Existing bookings receive an explicit, auditable policy backfill from the
-- owning producer. This migration is never applied without separate approval.
UPDATE "bookings" AS "booking"
SET
  "cancellation_policy_hours_snapshot" = "producer"."cancellation_policy_hours",
  "cancellation_policy_snapshotted_at" = now(),
  "cancellation_policy_backfilled" = true
FROM "producers" AS "producer"
WHERE "producer"."id" = "booking"."producer_id";

UPDATE "bookings"
SET "held_expires_at" = LEAST(
  "created_at" + interval '24 hours',
  "starts_at"
)
WHERE "status" = 'pending_approval';

ALTER TABLE "bookings"
  ALTER COLUMN "cancellation_policy_hours_snapshot" SET NOT NULL,
  ALTER COLUMN "cancellation_policy_snapshotted_at" SET NOT NULL,
  ADD CONSTRAINT "bookings_cancellation_policy_snapshot_shape"
    CHECK (
      "cancellation_policy_hours_snapshot" >= 0
      AND "cancellation_policy_snapshotted_at" >= "created_at"
    ),
  ADD CONSTRAINT "bookings_held_expiry_shape"
    CHECK (
      (
        "status" <> 'pending_approval'
        OR "held_expires_at" IS NOT NULL
      )
      AND (
        "held_expires_at" IS NULL
        OR "held_expires_at" = LEAST(
          "created_at" + interval '24 hours',
          "starts_at"
        )
      )
      AND (
        (
          "held_expired_at" IS NULL
          AND "held_expiry_reason" IS NULL
        )
        OR (
          "held_expired_at" IS NOT NULL
          AND "held_expiry_reason" = 'approval_timeout'
          AND "held_expires_at" IS NOT NULL
          AND "held_expired_at" >= "held_expires_at"
          AND "status" = 'cancelled'
          AND "outcome" = 'cancelled_by_producer'
        )
      )
    );

CREATE INDEX "bookings_allowance_use_idx"
  ON "bookings" ("session_allowance_id", "allowance_use_id");

-- Extend the existing booking identity guard to cover the immutable
-- eligibility/policy snapshots and the shared allowance-use identity. Actual
-- Held-expiry outcome fields remain mutable only through lifecycle commands.
CREATE OR REPLACE FUNCTION "protect_booking_identity"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_DELETE_FORBIDDEN';
  END IF;
  IF ROW(
    OLD."id", OLD."producer_id", OLD."project_id", OLD."purchase_id",
    OLD."session_allowance_id", OLD."starts_at", OLD."duration_min",
    OLD."operation_key", OLD."operation_digest",
    OLD."rescheduled_from_booking_id", OLD."allowance_use_id",
    OLD."cancellation_policy_hours_snapshot",
    OLD."cancellation_policy_snapshotted_at",
    OLD."cancellation_policy_backfilled",
    OLD."held_expires_at", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."project_id", NEW."purchase_id",
    NEW."session_allowance_id", NEW."starts_at", NEW."duration_min",
    NEW."operation_key", NEW."operation_digest",
    NEW."rescheduled_from_booking_id", NEW."allowance_use_id",
    NEW."cancellation_policy_hours_snapshot",
    NEW."cancellation_policy_snapshotted_at",
    NEW."cancellation_policy_backfilled",
    NEW."held_expires_at", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;
