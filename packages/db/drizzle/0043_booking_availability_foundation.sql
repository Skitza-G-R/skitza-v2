-- SK-190: shared booking metadata, credit treatment, calendar revision, and
-- producer-local daily-cap foundation. Google connection/link/outbox state is
-- intentionally absent from this migration.

-- Fail fast instead of waiting behind live booking/settings writers. The
-- migration runner applies this file in one transaction, so a busy target can
-- retry without observing a partial enum, column, backfill, or trigger change.
LOCK TABLE "producers", "bookings" IN ACCESS EXCLUSIVE MODE NOWAIT;

CREATE TYPE "booking_origin" AS ENUM (
  'legacy',
  'artist_request',
  'producer_manual'
);

CREATE TYPE "booking_billing_treatment" AS ENUM (
  'included',
  'complimentary',
  'billable_extra'
);

CREATE TYPE "booking_artist_rsvp_status" AS ENUM (
  'needs_action',
  'accepted',
  'declined',
  'tentative'
);

ALTER TABLE "producers"
  ADD COLUMN "max_sessions_per_day" integer,
  ADD CONSTRAINT "producers_max_sessions_per_day_shape"
    CHECK (
      "max_sessions_per_day" IS NULL
      OR "max_sessions_per_day" > 0
    );

ALTER TABLE "bookings"
  ADD COLUMN "title" text,
  ADD COLUMN "origin" "booking_origin" NOT NULL DEFAULT 'legacy',
  ADD COLUMN "billing_treatment" "booking_billing_treatment" NOT NULL DEFAULT 'included',
  ADD COLUMN "calendar_revision" integer NOT NULL DEFAULT 0,
  ADD COLUMN "artist_rsvp_status" "booking_artist_rsvp_status",
  ADD COLUMN "artist_rsvp_responded_at" timestamp with time zone,
  ADD COLUMN "updated_at" timestamp with time zone;

-- Every pre-SK-190 booking was created by the legacy allowance path. The
-- column defaults above preserve that origin while retaining its existing
-- allowance-consuming behavior as `included`. Backfill a display title only
-- from the booking's immutable purchase/project ownership graph; leave the
-- value NULL when neither source has meaningful text so application reads can
-- keep their safe legacy fallback.
UPDATE "bookings" AS "booking"
SET "title" = COALESCE(
  NULLIF(btrim("purchase"."commercial_snapshot"->>'productOrOfferName'), ''),
  NULLIF(btrim("project"."title"), '')
)
FROM "purchases" AS "purchase"
INNER JOIN "projects" AS "project"
  ON "project"."id" = "purchase"."project_id"
 AND "project"."producer_id" = "purchase"."producer_id"
 AND "project"."client_contact_id" = "purchase"."client_contact_id"
WHERE "booking"."purchase_id" = "purchase"."id"
  AND "booking"."project_id" = "purchase"."project_id"
  AND "booking"."producer_id" = "purchase"."producer_id";

-- Preserve the newest durable booking timestamp rather than pretending every
-- historical booking changed when this migration ran.
UPDATE "bookings"
SET "updated_at" = GREATEST(
  "created_at",
  COALESCE("status_changed_at", "created_at"),
  COALESCE("outcome_changed_at", "created_at")
);

ALTER TABLE "bookings"
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ADD CONSTRAINT "bookings_title_shape"
    CHECK (
      "title" IS NULL
      OR NULLIF(btrim("title"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "bookings_calendar_revision_shape"
    CHECK ("calendar_revision" >= 0),
  ADD CONSTRAINT "bookings_artist_rsvp_shape"
    CHECK ((
      ("artist_rsvp_status" IS NULL AND "artist_rsvp_responded_at" IS NULL)
      OR ("artist_rsvp_status" = 'needs_action' AND "artist_rsvp_responded_at" IS NULL)
      OR (
        "artist_rsvp_status" IN ('accepted', 'declined', 'tentative')
        AND "artist_rsvp_responded_at" IS NOT NULL
      )
    ) IS TRUE),
  ADD CONSTRAINT "bookings_updated_at_shape"
    CHECK ("updated_at" >= "created_at");

-- Keep the existing immutable command/ownership/snapshot boundary, and add
-- origin plus billing treatment to it. Display title and RSVP are intentionally
-- mutable, but title/status/outcome changes must advance the Skitza calendar
-- revision. Reminder-delivery stamps may update without creating a calendar
-- revision. Revisions and updated_at may never move backwards.
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
    OLD."held_expires_at", OLD."origin", OLD."billing_treatment",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."project_id", NEW."purchase_id",
    NEW."session_allowance_id", NEW."starts_at", NEW."duration_min",
    NEW."operation_key", NEW."operation_digest",
    NEW."rescheduled_from_booking_id", NEW."allowance_use_id",
    NEW."cancellation_policy_hours_snapshot",
    NEW."cancellation_policy_snapshotted_at",
    NEW."cancellation_policy_backfilled",
    NEW."held_expires_at", NEW."origin", NEW."billing_treatment",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW."calendar_revision" < OLD."calendar_revision" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_REVISION_REGRESSION';
  END IF;

  IF ROW(OLD."title", OLD."status", OLD."outcome")
    IS DISTINCT FROM ROW(NEW."title", NEW."status", NEW."outcome")
    AND NEW."calendar_revision" <= OLD."calendar_revision"
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_REVISION_REQUIRED';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_UPDATED_AT_REGRESSION';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;
