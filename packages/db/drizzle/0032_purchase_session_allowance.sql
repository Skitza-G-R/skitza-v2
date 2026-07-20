-- SK-68: purchase-owned session allowance booking commands and lifecycle audit.
--
-- This migration only changes repository schema. Apply it through
-- packages/db/apply-migrations.mjs after an exact non-production target is
-- approved; never through drizzle-kit migrate.

-- The legacy application reaches these tables in different orders across
-- accept, book, confirm, cancel, and lifecycle commands. Acquire the complete
-- affected set before any DDL and fail fast if traffic owns any lock. The
-- migration runner wraps this file in one transaction, so a busy target rolls
-- back cleanly and can be retried without deadlocking an application command.
LOCK TABLE
  "projects",
  "bookings",
  "purchase_acceptances",
  "purchase_session_allowances"
IN ACCESS EXCLUSIVE MODE NOWAIT;

CREATE TYPE "booking_transition_kind" AS ENUM (
  'created',
  'confirmed',
  'rejected',
  'artist_cancelled',
  'producer_cancelled',
  'rescheduled',
  'completed',
  'no_show'
);

CREATE TYPE "booking_transition_actor_kind" AS ENUM (
  'artist',
  'producer',
  'system'
);

ALTER TABLE "bookings"
  ADD COLUMN "operation_key" text,
  ADD COLUMN "operation_digest" text,
  ADD COLUMN "rescheduled_from_booking_id" uuid;

-- Existing rows predate command keys. Give each one a deterministic identity;
-- new writes always use a caller-owned stable key and a content digest.
UPDATE "bookings"
SET
  "operation_key" = 'legacy-booking:' || "id"::text,
  "operation_digest" = encode(
    sha256(convert_to('skitza-legacy-booking-v1|' || "id"::text, 'UTF8')),
    'hex'
  )
WHERE "operation_key" IS NULL OR "operation_digest" IS NULL;

-- Normalize any legacy terminal row before enforcing the purchase-use state
-- machine. Rows already carrying a more precise valid cancellation outcome are
-- preserved.
UPDATE "bookings"
SET
  "outcome" = CASE
    WHEN "status" IN ('pending_approval', 'confirmed') THEN 'reserved'::"session_use_outcome"
    WHEN "status" = 'rejected' THEN 'cancelled_by_producer'::"session_use_outcome"
    WHEN "status" = 'cancelled' AND "outcome" NOT IN (
      'cancelled_on_time', 'cancelled_by_producer', 'cancelled_late'
    ) THEN 'cancelled_by_producer'::"session_use_outcome"
    WHEN "status" = 'completed' THEN 'completed'::"session_use_outcome"
    WHEN "status" = 'no_show' THEN 'no_show'::"session_use_outcome"
    ELSE "outcome"
  END,
  "outcome_changed_at" = COALESCE("outcome_changed_at", "status_changed_at", "created_at");

ALTER TABLE "bookings"
  ALTER COLUMN "operation_key" SET NOT NULL,
  ALTER COLUMN "operation_digest" SET NOT NULL,
  ADD CONSTRAINT "bookings_id_lifecycle_unique"
    UNIQUE ("id", "producer_id", "purchase_id", "session_allowance_id"),
  ADD CONSTRAINT "bookings_producer_operation_key_unique"
    UNIQUE ("producer_id", "operation_key"),
  ADD CONSTRAINT "bookings_rescheduled_from_unique"
    UNIQUE ("rescheduled_from_booking_id"),
  ADD CONSTRAINT "bookings_rescheduled_from_producer_fk"
    FOREIGN KEY (
      "rescheduled_from_booking_id", "producer_id", "purchase_id", "session_allowance_id"
    ) REFERENCES "bookings" (
      "id", "producer_id", "purchase_id", "session_allowance_id"
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT "bookings_positive_duration"
    CHECK ("duration_min" > 0),
  ADD CONSTRAINT "bookings_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "bookings_reschedule_shape"
    CHECK (
      "rescheduled_from_booking_id" IS NULL
      OR "rescheduled_from_booking_id" <> "id"
    ),
  ADD CONSTRAINT "bookings_status_outcome_shape"
    CHECK (
      ("status" IN ('pending_approval', 'confirmed') AND "outcome" = 'reserved')
      OR ("status" = 'rejected' AND "outcome" = 'cancelled_by_producer')
      OR (
        "status" = 'cancelled'
        AND "outcome" IN ('cancelled_on_time', 'cancelled_by_producer', 'cancelled_late')
      )
      OR ("status" = 'completed' AND "outcome" = 'completed')
      OR ("status" = 'no_show' AND "outcome" = 'no_show')
    );

ALTER TABLE "purchase_session_allowances"
  ADD CONSTRAINT "purchase_session_allowances_terms_shape"
    CHECK (
      "duration_min" > 0
      AND "buffer_minutes" >= 0
      AND "min_lead_hours" >= 0
      AND NULLIF(btrim("location_type"), '') IS NOT NULL
    );

-- SK-95 Store acceptance predated centralized allowance materialization.
-- Recover only from immutable accepted purchase snapshots, preserving an
-- already-present private-offer allowance and allowing this migration to be
-- retried safely.
--
-- A project that completed and reopened before this migration has no durable
-- completion event when its Store purchase also has no allowance. Fail instead
-- of guessing open and restoring uses. Initial payment activation is safe and
-- distinguishable; any later pause/resume makes the missing history ambiguous.
-- An operator can resolve an affected purchase by explicitly inserting its
-- audited open or permanently closed allowance before retrying this migration.
DO $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchases" p
    INNER JOIN "purchase_acceptances" a ON a."purchase_id" = p."id"
    INNER JOIN "projects" pr
      ON pr."id" = p."project_id" AND pr."producer_id" = p."producer_id"
    LEFT JOIN "purchase_session_allowances" psa ON psa."purchase_id" = p."id"
    WHERE jsonb_typeof(p."commercial_snapshot"->'session') = 'object'
      AND psa."id" IS NULL
      AND p."lifecycle_status" <> 'canceled'
      AND pr."lifecycle_status" IN ('active', 'paused')
      AND p."accepted_at" < pr."lifecycle_changed_at"
      AND NOT (
        pr."lifecycle_status" = 'active'
        AND pr."lifecycle_changed_at" = (
          SELECT MIN(activated."activated_at")
          FROM "purchases" activated
          WHERE activated."project_id" = p."project_id"
            AND activated."producer_id" = p."producer_id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "project_payment_pause_events" pause_event
          WHERE pause_event."project_id" = p."project_id"
            AND pause_event."producer_id" = p."producer_id"
            AND pause_event."changed_at" > p."accepted_at"
        )
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_SK68_ALLOWANCE_BACKFILL_REQUIRES_LIFECYCLE_AUDIT';
  END IF;
END;
$function$;

INSERT INTO "purchase_session_allowances" (
  "purchase_id",
  "producer_id",
  "kind",
  "session_limit",
  "duration_min",
  "location_type",
  "buffer_minutes",
  "min_lead_hours",
  "closed_at",
  "close_reason",
  "created_at"
)
SELECT
  p."id",
  p."producer_id",
  (p."commercial_snapshot"->'session'->'limit'->>'kind')::"session_allowance_kind",
  CASE
    WHEN p."commercial_snapshot"->'session'->'limit'->>'kind' = 'fixed'
      THEN (p."commercial_snapshot"->'session'->'limit'->>'count')::integer
    ELSE NULL
  END,
  (p."commercial_snapshot"->'session'->>'durationMin')::integer,
  p."commercial_snapshot"->'session'->>'locationType',
  (p."commercial_snapshot"->'session'->>'bufferMinutes')::integer,
  (p."commercial_snapshot"->'session'->>'minLeadHours')::integer,
  CASE
    WHEN p."lifecycle_status" = 'canceled'
      AND (
        pr."lifecycle_status" NOT IN ('completed', 'canceled')
        OR p."canceled_at" < pr."lifecycle_changed_at"
      ) THEN p."canceled_at"
    WHEN pr."lifecycle_status" IN ('completed', 'canceled')
      THEN pr."lifecycle_changed_at"
    WHEN p."lifecycle_status" = 'canceled'
      THEN p."canceled_at"
    ELSE NULL
  END,
  CASE
    WHEN p."lifecycle_status" = 'canceled'
      AND (
        pr."lifecycle_status" NOT IN ('completed', 'canceled')
        OR p."canceled_at" < pr."lifecycle_changed_at"
      ) THEN 'purchase_canceled'::"session_allowance_close_reason"
    WHEN pr."lifecycle_status" = 'completed'
      THEN 'project_completed'::"session_allowance_close_reason"
    WHEN pr."lifecycle_status" = 'canceled'
      THEN 'project_canceled'::"session_allowance_close_reason"
    WHEN p."lifecycle_status" = 'canceled'
      THEN 'purchase_canceled'::"session_allowance_close_reason"
    ELSE NULL
  END,
  p."accepted_at"
FROM "purchases" p
INNER JOIN "purchase_acceptances" a ON a."purchase_id" = p."id"
INNER JOIN "projects" pr
  ON pr."id" = p."project_id" AND pr."producer_id" = p."producer_id"
WHERE jsonb_typeof(p."commercial_snapshot"->'session') = 'object'
ON CONFLICT ("purchase_id") DO NOTHING;

-- Acceptance and the matching immutable allowance may be inserted in either
-- order inside one transaction. Check the invariant only at commit so the new
-- application path succeeds while an old acceptance-only writer fails closed.
CREATE OR REPLACE FUNCTION "enforce_accepted_session_allowance"()
RETURNS trigger AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchases" p
    WHERE p."id" = NEW."purchase_id"
      AND p."producer_id" = NEW."producer_id"
      AND jsonb_typeof(p."commercial_snapshot"->'session') = 'object'
      AND NOT EXISTS (
        SELECT 1
        FROM "purchase_session_allowances" psa
        WHERE psa."purchase_id" = p."id"
          AND psa."producer_id" = p."producer_id"
          AND psa."kind"::text = p."commercial_snapshot"->'session'->'limit'->>'kind'
          AND psa."session_limit" IS NOT DISTINCT FROM CASE
            WHEN p."commercial_snapshot"->'session'->'limit'->>'kind' = 'fixed'
              THEN (p."commercial_snapshot"->'session'->'limit'->>'count')::integer
            ELSE NULL
          END
          AND psa."duration_min" = (p."commercial_snapshot"->'session'->>'durationMin')::integer
          AND psa."location_type" = p."commercial_snapshot"->'session'->>'locationType'
          AND psa."buffer_minutes" = (p."commercial_snapshot"->'session'->>'bufferMinutes')::integer
          AND psa."min_lead_hours" = (p."commercial_snapshot"->'session'->>'minLeadHours')::integer
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_ACCEPTED_SESSION_ALLOWANCE_REQUIRED';
  END IF;
  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "purchase_acceptances_require_session_allowance"
  AFTER INSERT OR UPDATE ON "purchase_acceptances"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "enforce_accepted_session_allowance"();

-- Do not let ON CONFLICT hide an existing allowance that disagrees with its
-- immutable accepted snapshot, and do not leave a current terminal owner open.
DO $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchases" p
    INNER JOIN "purchase_acceptances" a ON a."purchase_id" = p."id"
    LEFT JOIN "purchase_session_allowances" psa
      ON psa."purchase_id" = p."id" AND psa."producer_id" = p."producer_id"
    WHERE jsonb_typeof(p."commercial_snapshot"->'session') = 'object'
      AND (
        psa."id" IS NULL
        OR psa."kind"::text IS DISTINCT FROM p."commercial_snapshot"->'session'->'limit'->>'kind'
        OR psa."session_limit" IS DISTINCT FROM CASE
          WHEN p."commercial_snapshot"->'session'->'limit'->>'kind' = 'fixed'
            THEN (p."commercial_snapshot"->'session'->'limit'->>'count')::integer
          ELSE NULL
        END
        OR psa."duration_min" IS DISTINCT FROM (p."commercial_snapshot"->'session'->>'durationMin')::integer
        OR psa."location_type" IS DISTINCT FROM p."commercial_snapshot"->'session'->>'locationType'
        OR psa."buffer_minutes" IS DISTINCT FROM (p."commercial_snapshot"->'session'->>'bufferMinutes')::integer
        OR psa."min_lead_hours" IS DISTINCT FROM (p."commercial_snapshot"->'session'->>'minLeadHours')::integer
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_ACCEPTED_SESSION_ALLOWANCE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchases" p
    INNER JOIN "purchase_acceptances" a ON a."purchase_id" = p."id"
    INNER JOIN "projects" pr
      ON pr."id" = p."project_id" AND pr."producer_id" = p."producer_id"
    INNER JOIN "purchase_session_allowances" psa ON psa."purchase_id" = p."id"
    WHERE jsonb_typeof(p."commercial_snapshot"->'session') = 'object'
      AND (
        pr."lifecycle_status" IN ('completed', 'canceled')
        OR p."lifecycle_status" = 'canceled'
      )
      AND psa."closed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_TERMINAL_SESSION_ALLOWANCE_MUST_BE_CLOSED';
  END IF;
END;
$function$;

CREATE TABLE "booking_transition_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "kind" "booking_transition_kind" NOT NULL,
  "actor_kind" "booking_transition_actor_kind" NOT NULL,
  "actor_id" text,
  "from_status" "booking_status",
  "to_status" "booking_status" NOT NULL,
  "from_outcome" "session_use_outcome",
  "to_outcome" "session_use_outcome" NOT NULL,
  "old_starts_at" timestamptz,
  "new_starts_at" timestamptz,
  "occurred_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "booking_transition_events_operation_key_unique"
    UNIQUE ("booking_id", "operation_key"),
  CONSTRAINT "booking_transition_events_booking_producer_fk"
    FOREIGN KEY ("booking_id", "producer_id")
    REFERENCES "bookings" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "booking_transition_events_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  CONSTRAINT "booking_transition_events_actor_shape"
    CHECK (
      ("actor_kind" = 'system' AND "actor_id" IS NULL)
      OR (
        "actor_kind" IN ('artist', 'producer')
        AND NULLIF(btrim("actor_id"), '') IS NOT NULL
      )
    ),
  CONSTRAINT "booking_transition_events_state_shape"
    CHECK ((
      (
        "kind" = 'created'
        AND "from_status" IS NULL
        AND "from_outcome" IS NULL
        AND "to_status" IN ('pending_approval', 'confirmed')
        AND "to_outcome" = 'reserved'
      )
      OR (
        "kind" = 'confirmed'
        AND "from_status" = 'pending_approval'
        AND "to_status" = 'confirmed'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" = 'reserved'
      )
      OR (
        "kind" = 'rejected'
        AND "from_status" = 'pending_approval'
        AND "to_status" = 'rejected'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" = 'cancelled_by_producer'
      )
      OR (
        "kind" = 'artist_cancelled'
        AND "from_status" IN ('pending_approval', 'confirmed')
        AND "to_status" = 'cancelled'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" IN ('cancelled_on_time', 'cancelled_late')
      )
      OR (
        "kind" = 'producer_cancelled'
        AND "from_status" IN ('pending_approval', 'confirmed')
        AND "to_status" = 'cancelled'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" = 'cancelled_by_producer'
      )
      OR (
        "kind" = 'rescheduled'
        AND (
          (
            "from_status" IN ('pending_approval', 'confirmed')
            AND "to_status" = 'cancelled'
            AND "from_outcome" = 'reserved'
            AND "to_outcome" = 'cancelled_on_time'
          )
          OR (
            "from_status" IS NULL
            AND "from_outcome" IS NULL
            AND "to_status" IN ('pending_approval', 'confirmed')
            AND "to_outcome" = 'reserved'
          )
        )
      )
      OR (
        "kind" = 'completed'
        AND "from_status" = 'confirmed'
        AND "to_status" = 'completed'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" = 'completed'
      )
      OR (
        "kind" = 'no_show'
        AND "from_status" = 'confirmed'
        AND "to_status" = 'no_show'
        AND "from_outcome" = 'reserved'
        AND "to_outcome" = 'no_show'
      )
    ) IS TRUE),
  CONSTRAINT "booking_transition_events_reschedule_shape"
    CHECK (
      ("kind" = 'created' AND "old_starts_at" IS NULL AND "new_starts_at" IS NOT NULL)
      OR (
        "kind" = 'rescheduled'
        AND "new_starts_at" IS NOT NULL
        AND (
          ("from_status" IS NULL AND "old_starts_at" IS NULL)
          OR ("from_status" IS NOT NULL AND "old_starts_at" IS NOT NULL)
        )
      )
      OR (
        "kind" NOT IN ('created', 'rescheduled')
        AND "old_starts_at" IS NOT NULL
        AND "new_starts_at" IS NULL
      )
    )
);

CREATE INDEX "booking_transition_events_booking_occurred_idx"
  ON "booking_transition_events" ("booking_id", "occurred_at", "id");

CREATE INDEX "booking_transition_events_producer_occurred_idx"
  ON "booking_transition_events" ("producer_id", "occurred_at", "id");

CREATE TRIGGER "booking_transition_events_append_only"
  BEFORE UPDATE OR DELETE ON "booking_transition_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- The SK-90 guard already prevents deletion and immutable ownership changes.
-- Extend it so command identity and reschedule ancestry can never be rewritten.
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
    OLD."rescheduled_from_booking_id", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."project_id", NEW."purchase_id",
    NEW."session_allowance_id", NEW."starts_at", NEW."duration_min",
    NEW."operation_key", NEW."operation_digest",
    NEW."rescheduled_from_booking_id", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "bookings_protect_identity" ON "bookings";
CREATE TRIGGER "bookings_protect_identity"
  BEFORE UPDATE OR DELETE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "protect_booking_identity"();
