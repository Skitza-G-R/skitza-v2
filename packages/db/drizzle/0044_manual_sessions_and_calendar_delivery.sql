-- SK-191: durable artist change requests and the provider-neutral base outbox
-- for idempotent .ics invitation delivery. This migration is additive only;
-- Google connection, event-link, OAuth, and webhook state remain out of scope.

CREATE TYPE "booking_change_request_kind" AS ENUM (
  'cancel',
  'reschedule'
);

CREATE TYPE "booking_change_request_status" AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE "calendar_sync_job_operation" AS ENUM ('send_ics');

CREATE TYPE "calendar_sync_job_status" AS ENUM (
  'pending',
  'processing',
  'completed',
  'terminal'
);

-- This redundant-by-id unique key lets the request table enforce exact
-- reschedule lineage with one composite foreign key, not merely same-producer
-- ownership of an arbitrary replacement booking.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_id_producer_rescheduled_from_unique"
  UNIQUE ("id", "producer_id", "rescheduled_from_booking_id");

-- A pending request never mutates the source booking. Producer decisions are
-- audited separately, and only an approved reschedule may reference the exact
-- replacement booking created by the locked lifecycle command.
CREATE TABLE "booking_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "kind" "booking_change_request_kind" NOT NULL,
  "status" "booking_change_request_status" DEFAULT 'pending' NOT NULL,
  "proposed_starts_at" timestamp with time zone,
  "request_operation_key" text NOT NULL,
  "request_operation_digest" text NOT NULL,
  "requested_by_clerk_user_id" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "decision_operation_key" text,
  "decision_operation_digest" text,
  "decided_by_clerk_user_id" text,
  "decided_at" timestamp with time zone,
  "replacement_booking_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_change_requests_request_operation_unique"
    UNIQUE ("booking_id", "request_operation_key"),
  CONSTRAINT "booking_change_requests_booking_producer_fk"
    FOREIGN KEY ("booking_id", "producer_id")
    REFERENCES "bookings" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "booking_change_requests_replacement_booking_producer_fk"
    FOREIGN KEY ("replacement_booking_id", "producer_id")
    REFERENCES "bookings" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "booking_change_requests_replacement_booking_lineage_fk"
    FOREIGN KEY ("replacement_booking_id", "producer_id", "booking_id")
    REFERENCES "bookings" (
      "id",
      "producer_id",
      "rescheduled_from_booking_id"
    ) ON DELETE RESTRICT,
  CONSTRAINT "booking_change_requests_request_identity_shape" CHECK ((
    NULLIF(btrim("request_operation_key"), '') IS NOT NULL
    AND char_length("request_operation_key") <= 200
    AND NULLIF(btrim("request_operation_digest"), '') IS NOT NULL
    AND "requested_by_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
  ) IS TRUE),
  CONSTRAINT "booking_change_requests_proposed_start_shape" CHECK ((
    (
      "kind" = 'cancel'
      AND "proposed_starts_at" IS NULL
    )
    OR (
      "kind" = 'reschedule'
      AND "proposed_starts_at" IS NOT NULL
    )
  ) IS TRUE),
  CONSTRAINT "booking_change_requests_replacement_identity_shape"
    CHECK (
      "replacement_booking_id" IS NULL
      OR "replacement_booking_id" <> "booking_id"
    ),
  CONSTRAINT "booking_change_requests_decision_shape" CHECK ((
    (
      "status" = 'pending'
      AND "decision_operation_key" IS NULL
      AND "decision_operation_digest" IS NULL
      AND "decided_by_clerk_user_id" IS NULL
      AND "decided_at" IS NULL
      AND "replacement_booking_id" IS NULL
    )
    OR (
      "status" IN ('approved', 'rejected')
      AND NULLIF(btrim("decision_operation_key"), '') IS NOT NULL
      AND char_length("decision_operation_key") <= 200
      AND NULLIF(btrim("decision_operation_digest"), '') IS NOT NULL
      AND "decided_by_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "decided_at" IS NOT NULL
      AND "decided_at" >= "requested_at"
      AND (
        (
          "status" = 'approved'
          AND "kind" = 'reschedule'
          AND "replacement_booking_id" IS NOT NULL
        )
        OR (
          "status" = 'approved'
          AND "kind" = 'cancel'
          AND "replacement_booking_id" IS NULL
        )
        OR (
          "status" = 'rejected'
          AND "replacement_booking_id" IS NULL
        )
      )
    )
  ) IS TRUE),
  CONSTRAINT "booking_change_requests_timestamp_shape"
    CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "booking_change_requests_decision_operation_unique"
  ON "booking_change_requests" ("booking_id", "decision_operation_key")
  WHERE "decision_operation_key" IS NOT NULL;

CREATE UNIQUE INDEX "booking_change_requests_one_pending_per_booking"
  ON "booking_change_requests" ("booking_id")
  WHERE "status" = 'pending';

CREATE UNIQUE INDEX "booking_change_requests_replacement_booking_unique"
  ON "booking_change_requests" ("replacement_booking_id")
  WHERE "replacement_booking_id" IS NOT NULL;

CREATE INDEX "booking_change_requests_producer_status_requested_idx"
  ON "booking_change_requests" (
    "producer_id",
    "status",
    "requested_at",
    "id"
  );

CREATE INDEX "booking_change_requests_booking_requested_idx"
  ON "booking_change_requests" ("booking_id", "requested_at", "id");

-- The request intent and its source ownership never change. Resolution is a
-- one-way pending -> approved/rejected transition and becomes immutable once
-- recorded, preserving a durable decision audit.
CREATE FUNCTION "protect_booking_change_request"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CHANGE_REQUEST_DELETE_FORBIDDEN';
  END IF;

  IF ROW(
    OLD."id", OLD."booking_id", OLD."producer_id", OLD."kind",
    OLD."proposed_starts_at", OLD."request_operation_key",
    OLD."request_operation_digest", OLD."requested_by_clerk_user_id",
    OLD."requested_at", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."booking_id", NEW."producer_id", NEW."kind",
    NEW."proposed_starts_at", NEW."request_operation_key",
    NEW."request_operation_digest", NEW."requested_by_clerk_user_id",
    NEW."requested_at", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CHANGE_REQUEST_INTENT_IMMUTABLE';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CHANGE_REQUEST_TIMESTAMP_REGRESSION';
  END IF;

  IF OLD."status" <> 'pending' AND ROW(
    OLD."status", OLD."decision_operation_key",
    OLD."decision_operation_digest", OLD."decided_by_clerk_user_id",
    OLD."decided_at", OLD."replacement_booking_id", OLD."updated_at"
  ) IS DISTINCT FROM ROW(
    NEW."status", NEW."decision_operation_key",
    NEW."decision_operation_digest", NEW."decided_by_clerk_user_id",
    NEW."decided_at", NEW."replacement_booking_id", NEW."updated_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CHANGE_REQUEST_RESOLUTION_IMMUTABLE';
  END IF;

  IF OLD."status" = 'pending'
    AND NEW."status" <> OLD."status"
    AND NEW."updated_at" <= OLD."updated_at"
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CHANGE_REQUEST_UPDATED_AT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "booking_change_requests_protect"
  BEFORE UPDATE OR DELETE ON "booking_change_requests"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_booking_change_request"();

-- Each row owns one immutable, fully snapshotted invitation intent. A worker
-- may lease and retry the row, but it may never rebuild the payload from live
-- producer, contact, or booking data. This guarantees byte-stable retries and
-- a stable provider idempotency key.
CREATE TABLE "calendar_sync_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation" "calendar_sync_job_operation" NOT NULL,
  "status" "calendar_sync_job_status" DEFAULT 'pending' NOT NULL,
  "desired_revision" integer NOT NULL,
  "idempotency_key" text NOT NULL,
  "payload_snapshot" jsonb NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "first_attempt_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "provider_dedupe_expires_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone DEFAULT now(),
  "lease_token" text,
  "lease_acquired_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "provider_message_id" text,
  "completed_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "terminal_error" text,
  "manual_retry_count" integer DEFAULT 0 NOT NULL,
  "last_manual_retry_at" timestamp with time zone,
  "last_manual_retry_actor" text,
  "last_manual_retry_operation_key" text,
  "last_manual_retry_operation_digest" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_sync_jobs_idempotency_unique"
    UNIQUE ("idempotency_key"),
  CONSTRAINT "calendar_sync_jobs_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "calendar_sync_jobs_booking_operation_revision_unique"
    UNIQUE ("booking_id", "operation", "desired_revision"),
  CONSTRAINT "calendar_sync_jobs_booking_producer_fk"
    FOREIGN KEY ("booking_id", "producer_id")
    REFERENCES "bookings" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "calendar_sync_jobs_identity_shape" CHECK ((
    "desired_revision" > 0
    AND NULLIF(btrim("idempotency_key"), '') IS NOT NULL
    AND char_length("idempotency_key") <= 256
    AND "attempt_count" >= 0
    AND "manual_retry_count" >= 0
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_payload_shape" CHECK ((
    jsonb_typeof("payload_snapshot") = 'object'
    AND "payload_snapshot"->>'schemaVersion' = '1'
    AND "payload_snapshot"->>'method' IN ('REQUEST', 'CANCEL')
    AND ("payload_snapshot"->>'sequence') ~ '^[0-9]+$'
    AND ("payload_snapshot"->>'sequence')::integer = "desired_revision"
    AND NULLIF(btrim("payload_snapshot"->>'uid'), '') IS NOT NULL
    AND char_length("payload_snapshot"->>'uid') <= 255
    AND NULLIF(btrim("payload_snapshot"->>'dtstampUtc'), '') IS NOT NULL
    AND right("payload_snapshot"->>'dtstampUtc', 1) = 'Z'
    AND NULLIF(btrim("payload_snapshot"->>'startsAtUtc'), '') IS NOT NULL
    AND right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'
    AND NULLIF(btrim("payload_snapshot"->>'endsAtUtc'), '') IS NOT NULL
    AND right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'
    AND NULLIF(btrim("payload_snapshot"->>'summary'), '') IS NOT NULL
    AND jsonb_typeof("payload_snapshot"->'description') = 'string'
    AND jsonb_typeof("payload_snapshot"->'organizer') = 'object'
    AND NULLIF(
      btrim("payload_snapshot"->'organizer'->>'name'),
      ''
    ) IS NOT NULL
    AND NULLIF(
      btrim("payload_snapshot"->'organizer'->>'email'),
      ''
    ) IS NOT NULL
    AND jsonb_typeof("payload_snapshot"->'attendee') = 'object'
    AND NULLIF(
      btrim("payload_snapshot"->'attendee'->>'name'),
      ''
    ) IS NOT NULL
    AND NULLIF(
      btrim("payload_snapshot"->'attendee'->>'email'),
      ''
    ) IS NOT NULL
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_attempt_shape" CHECK ((
    (
      "attempt_count" = 0
      AND "first_attempt_at" IS NULL
      AND "last_attempt_at" IS NULL
      AND "provider_dedupe_expires_at" IS NULL
    )
    OR (
      "attempt_count" > 0
      AND "first_attempt_at" IS NOT NULL
      AND "last_attempt_at" >= "first_attempt_at"
      AND "provider_dedupe_expires_at" > "first_attempt_at"
    )
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_state_shape" CHECK ((
    (
      "status" = 'pending'
      AND "next_attempt_at" IS NOT NULL
      AND "lease_token" IS NULL
      AND "lease_acquired_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "provider_message_id" IS NULL
      AND "completed_at" IS NULL
      AND "terminal_at" IS NULL
      AND "terminal_error" IS NULL
    )
    OR (
      "status" = 'processing'
      AND "next_attempt_at" IS NULL
      AND NULLIF(btrim("lease_token"), '') IS NOT NULL
      AND "lease_acquired_at" IS NOT NULL
      AND "lease_acquired_at" = "last_attempt_at"
      AND "lease_expires_at" > "lease_acquired_at"
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "completed_at" IS NULL
      AND "terminal_at" IS NULL
      AND "terminal_error" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "next_attempt_at" IS NULL
      AND "lease_token" IS NULL
      AND "lease_acquired_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "attempt_count" > 0
      AND NULLIF(btrim("provider_message_id"), '') IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "terminal_at" IS NULL
      AND "terminal_error" IS NULL
    )
    OR (
      "status" = 'terminal'
      AND "next_attempt_at" IS NULL
      AND "lease_token" IS NULL
      AND "lease_acquired_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "completed_at" IS NULL
      AND "terminal_at" IS NOT NULL
      AND NULLIF(btrim("terminal_error"), '') IS NOT NULL
    )
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_timestamp_shape" CHECK ((
    "updated_at" >= "created_at"
    AND (
      "first_attempt_at" IS NULL
      OR "first_attempt_at" >= "created_at"
    )
    AND (
      "last_attempt_at" IS NULL
      OR "last_attempt_at" >= "first_attempt_at"
    )
    AND (
      "completed_at" IS NULL
      OR "completed_at" >= "last_attempt_at"
    )
    AND (
      "terminal_at" IS NULL
      OR "terminal_at" >= "last_attempt_at"
    )
    AND (
      "last_manual_retry_at" IS NULL
      OR "last_manual_retry_at" >= "created_at"
    )
    AND (
      "last_manual_retry_at" IS NULL
      OR "updated_at" >= "last_manual_retry_at"
    )
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_manual_retry_shape" CHECK ((
    (
      "manual_retry_count" = 0
      AND "last_manual_retry_at" IS NULL
      AND "last_manual_retry_actor" IS NULL
      AND "last_manual_retry_operation_key" IS NULL
      AND "last_manual_retry_operation_digest" IS NULL
    )
    OR (
      "manual_retry_count" > 0
      AND "last_manual_retry_at" IS NOT NULL
      AND NULLIF(btrim("last_manual_retry_actor"), '') IS NOT NULL
      AND NULLIF(btrim("last_manual_retry_operation_key"), '') IS NOT NULL
      AND "last_manual_retry_operation_digest" ~ '^sha256:[0-9a-f]{64}$'
    )
  ) IS TRUE),
  CONSTRAINT "calendar_sync_jobs_error_shape" CHECK ((
    (
      "last_error" IS NULL
      OR (
        NULLIF(btrim("last_error"), '') IS NOT NULL
        AND char_length("last_error") <= 4000
      )
    )
    AND (
      "terminal_error" IS NULL
      OR char_length("terminal_error") <= 4000
    )
    AND (
      "lease_token" IS NULL
      OR char_length("lease_token") <= 200
    )
    AND (
      "last_manual_retry_actor" IS NULL
      OR char_length("last_manual_retry_actor") <= 200
    )
    AND (
      "last_manual_retry_operation_key" IS NULL
      OR char_length("last_manual_retry_operation_key") <= 200
    )
  ) IS TRUE)
);

-- A single stable UID/revision can produce only one semantic calendar update.
-- In particular, rescheduling enqueues one higher-SEQUENCE REQUEST rather than
-- a CANCEL and REQUEST pair for the same event lineage revision.
CREATE UNIQUE INDEX "calendar_sync_jobs_uid_revision_unique"
  ON "calendar_sync_jobs" (("payload_snapshot"->>'uid'), "desired_revision");

CREATE INDEX "calendar_sync_jobs_claim_idx"
  ON "calendar_sync_jobs" (
    "status",
    "next_attempt_at",
    "lease_expires_at",
    "id"
  );

CREATE INDEX "calendar_sync_jobs_booking_revision_idx"
  ON "calendar_sync_jobs" (
    "booking_id",
    "desired_revision",
    "created_at",
    "id"
  );

CREATE INDEX "calendar_sync_jobs_producer_updated_idx"
  ON "calendar_sync_jobs" ("producer_id", "updated_at", "id");

-- A manual reissue rotates the provider idempotency identity only after an
-- operator explicitly targets one terminal tenant-owned job. Every completed
-- delivery cycle remains append-only here before the live job is reset.
CREATE TABLE "calendar_sync_job_manual_retries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "retry_number" integer NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "actor_identity" text NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "prior_idempotency_key" text NOT NULL,
  "new_idempotency_key" text NOT NULL,
  "prior_attempt_count" integer NOT NULL,
  "prior_first_attempt_at" timestamp with time zone NOT NULL,
  "prior_last_attempt_at" timestamp with time zone NOT NULL,
  "prior_provider_dedupe_expires_at" timestamp with time zone NOT NULL,
  "prior_last_error" text,
  "prior_terminal_at" timestamp with time zone NOT NULL,
  "prior_terminal_error" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "calendar_sync_job_manual_retries_job_retry_unique"
    UNIQUE ("job_id", "retry_number"),
  CONSTRAINT "calendar_sync_job_manual_retries_operation_unique"
    UNIQUE ("operation_key"),
  CONSTRAINT "calendar_sync_job_manual_retries_new_idempotency_unique"
    UNIQUE ("new_idempotency_key"),
  CONSTRAINT "calendar_sync_job_manual_retries_job_producer_fk"
    FOREIGN KEY ("job_id", "producer_id")
    REFERENCES "calendar_sync_jobs" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "calendar_sync_job_manual_retries_identity_shape" CHECK ((
    "retry_number" > 0
    AND NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND char_length("operation_key") <= 200
    AND "operation_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND NULLIF(btrim("actor_identity"), '') IS NOT NULL
    AND char_length("actor_identity") <= 200
    AND NULLIF(btrim("prior_idempotency_key"), '') IS NOT NULL
    AND char_length("prior_idempotency_key") <= 256
    AND NULLIF(btrim("new_idempotency_key"), '') IS NOT NULL
    AND char_length("new_idempotency_key") <= 256
    AND "new_idempotency_key" <> "prior_idempotency_key"
  ) IS TRUE),
  CONSTRAINT "calendar_sync_job_manual_retries_prior_attempt_shape" CHECK ((
    "prior_attempt_count" > 0
    AND "prior_last_attempt_at" >= "prior_first_attempt_at"
    AND "prior_provider_dedupe_expires_at" > "prior_first_attempt_at"
  ) IS TRUE),
  CONSTRAINT "calendar_sync_job_manual_retries_timestamp_shape" CHECK ((
    "prior_terminal_at" >= "prior_last_attempt_at"
    AND "requested_at" >= "prior_terminal_at"
    AND "created_at" = "requested_at"
  ) IS TRUE),
  CONSTRAINT "calendar_sync_job_manual_retries_error_shape" CHECK ((
    NULLIF(btrim("prior_terminal_error"), '') IS NOT NULL
    AND char_length("prior_terminal_error") <= 4000
    AND (
      "prior_last_error" IS NULL
      OR (
        NULLIF(btrim("prior_last_error"), '') IS NOT NULL
        AND char_length("prior_last_error") <= 4000
      )
    )
  ) IS TRUE)
);

CREATE INDEX "calendar_sync_job_manual_retries_producer_requested_idx"
  ON "calendar_sync_job_manual_retries" ("producer_id", "requested_at", "id");

CREATE FUNCTION "protect_calendar_sync_job_manual_retry"()
RETURNS trigger AS $function$
BEGIN
  RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_MANUAL_RETRY_AUDIT_IMMUTABLE';
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_job_manual_retries_protect"
  BEFORE UPDATE OR DELETE ON "calendar_sync_job_manual_retries"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_calendar_sync_job_manual_retry"();

CREATE FUNCTION "protect_calendar_sync_job"()
RETURNS trigger AS $function$
DECLARE
  is_manual_retry boolean := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_DELETE_FORBIDDEN';
  END IF;

  -- A terminal row may be reissued only when an append-only audit row in the
  -- same transaction proves the exact old cycle, operator command, new
  -- provider identity, and reset shape.
  SELECT EXISTS (
    SELECT 1
    FROM "calendar_sync_job_manual_retries" AS retry
    WHERE OLD."status" = 'terminal'
      AND NEW."status" = 'pending'
      AND retry."job_id" = OLD."id"
      AND retry."producer_id" = OLD."producer_id"
      AND retry."retry_number" = OLD."manual_retry_count" + 1
      AND retry."retry_number" = NEW."manual_retry_count"
      AND retry."operation_key" = NEW."last_manual_retry_operation_key"
      AND retry."operation_digest" = NEW."last_manual_retry_operation_digest"
      AND retry."actor_identity" = NEW."last_manual_retry_actor"
      AND retry."requested_at" = NEW."last_manual_retry_at"
      AND retry."prior_idempotency_key" = OLD."idempotency_key"
      AND retry."new_idempotency_key" = NEW."idempotency_key"
      AND retry."prior_attempt_count" = OLD."attempt_count"
      AND retry."prior_first_attempt_at" = OLD."first_attempt_at"
      AND retry."prior_last_attempt_at" = OLD."last_attempt_at"
      AND retry."prior_provider_dedupe_expires_at" = OLD."provider_dedupe_expires_at"
      AND retry."prior_last_error" IS NOT DISTINCT FROM OLD."last_error"
      AND retry."prior_terminal_at" = OLD."terminal_at"
      AND retry."prior_terminal_error" = OLD."terminal_error"
      AND NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
      AND NEW."attempt_count" = 0
      AND NEW."first_attempt_at" IS NULL
      AND NEW."last_attempt_at" IS NULL
      AND NEW."provider_dedupe_expires_at" IS NULL
      AND NEW."next_attempt_at" = NEW."last_manual_retry_at"
      AND NEW."lease_token" IS NULL
      AND NEW."lease_acquired_at" IS NULL
      AND NEW."lease_expires_at" IS NULL
      AND NEW."last_error" IS NULL
      AND NEW."provider_message_id" IS NULL
      AND NEW."completed_at" IS NULL
      AND NEW."terminal_at" IS NULL
      AND NEW."terminal_error" IS NULL
      AND NEW."updated_at" = NEW."last_manual_retry_at"
      AND NEW."updated_at" > OLD."updated_at"
  ) INTO is_manual_retry;

  IF ROW(
    OLD."id", OLD."booking_id", OLD."producer_id", OLD."operation",
    OLD."desired_revision", OLD."payload_snapshot", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."booking_id", NEW."producer_id", NEW."operation",
    NEW."desired_revision", NEW."payload_snapshot", NEW."created_at"
  ) OR (
    NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    AND NOT is_manual_retry
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_INTENT_IMMUTABLE';
  END IF;

  IF ROW(
    OLD."manual_retry_count", OLD."last_manual_retry_at",
    OLD."last_manual_retry_actor", OLD."last_manual_retry_operation_key",
    OLD."last_manual_retry_operation_digest"
  ) IS DISTINCT FROM ROW(
    NEW."manual_retry_count", NEW."last_manual_retry_at",
    NEW."last_manual_retry_actor", NEW."last_manual_retry_operation_key",
    NEW."last_manual_retry_operation_digest"
  ) AND NOT is_manual_retry THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_MANUAL_RETRY_AUDIT_IMMUTABLE';
  END IF;

  IF NEW."attempt_count" < OLD."attempt_count" AND NOT is_manual_retry THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_ATTEMPT_REGRESSION';
  END IF;

  IF OLD."first_attempt_at" IS NOT NULL
    AND NEW."first_attempt_at" IS DISTINCT FROM OLD."first_attempt_at"
    AND NOT is_manual_retry
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_FIRST_ATTEMPT_IMMUTABLE';
  END IF;

  IF OLD."provider_dedupe_expires_at" IS NOT NULL
    AND NEW."provider_dedupe_expires_at"
      IS DISTINCT FROM OLD."provider_dedupe_expires_at"
    AND NOT is_manual_retry
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_DEDUPE_EXPIRY_IMMUTABLE';
  END IF;

  IF OLD."last_attempt_at" IS NOT NULL
    AND NEW."last_attempt_at" IS DISTINCT FROM OLD."last_attempt_at"
    AND (
      NEW."last_attempt_at" IS NULL
      OR NEW."last_attempt_at" < OLD."last_attempt_at"
    )
    AND NOT is_manual_retry
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_LAST_ATTEMPT_REGRESSION';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_TIMESTAMP_REGRESSION';
  END IF;

  IF OLD."status" = 'pending' AND NEW."status" NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_TRANSITION_INVALID';
  END IF;

  IF OLD."status" = 'processing'
    AND NEW."status" NOT IN ('pending', 'processing', 'completed', 'terminal')
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_TRANSITION_INVALID';
  END IF;

  IF OLD."status" IN ('completed', 'terminal') AND ROW(
    OLD."idempotency_key",
    OLD."status", OLD."attempt_count", OLD."first_attempt_at",
    OLD."last_attempt_at", OLD."provider_dedupe_expires_at",
    OLD."next_attempt_at",
    OLD."lease_token", OLD."lease_acquired_at", OLD."lease_expires_at",
    OLD."last_error", OLD."provider_message_id", OLD."completed_at",
    OLD."terminal_at", OLD."terminal_error",
    OLD."manual_retry_count", OLD."last_manual_retry_at",
    OLD."last_manual_retry_actor", OLD."last_manual_retry_operation_key",
    OLD."last_manual_retry_operation_digest", OLD."updated_at"
  ) IS DISTINCT FROM ROW(
    NEW."idempotency_key",
    NEW."status", NEW."attempt_count", NEW."first_attempt_at",
    NEW."last_attempt_at", NEW."provider_dedupe_expires_at",
    NEW."next_attempt_at",
    NEW."lease_token", NEW."lease_acquired_at", NEW."lease_expires_at",
    NEW."last_error", NEW."provider_message_id", NEW."completed_at",
    NEW."terminal_at", NEW."terminal_error",
    NEW."manual_retry_count", NEW."last_manual_retry_at",
    NEW."last_manual_retry_actor", NEW."last_manual_retry_operation_key",
    NEW."last_manual_retry_operation_digest", NEW."updated_at"
  ) AND NOT is_manual_retry THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_FINAL_STATE_IMMUTABLE';
  END IF;

  IF NEW."attempt_count" <> OLD."attempt_count"
    AND NOT is_manual_retry
    AND NOT (
      NEW."attempt_count" = OLD."attempt_count" + 1
      AND OLD."status" IN ('pending', 'processing')
      AND NEW."status" = 'processing'
    )
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_CLAIM_ATTEMPT_INVALID';
  END IF;

  IF OLD."status" = 'pending'
    AND NEW."status" = 'processing'
    AND NEW."attempt_count" <> OLD."attempt_count" + 1
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_CLAIM_ATTEMPT_REQUIRED';
  END IF;

  IF NEW."attempt_count" > OLD."attempt_count"
    AND NOT is_manual_retry
    AND (
      NEW."last_attempt_at" IS NULL
      OR (
        OLD."last_attempt_at" IS NOT NULL
        AND NEW."last_attempt_at" <= OLD."last_attempt_at"
      )
    )
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_LAST_ATTEMPT_REQUIRED';
  END IF;

  IF ROW(
    OLD."status", OLD."attempt_count", OLD."first_attempt_at",
    OLD."last_attempt_at", OLD."provider_dedupe_expires_at",
    OLD."next_attempt_at",
    OLD."lease_token", OLD."lease_acquired_at", OLD."lease_expires_at",
    OLD."last_error", OLD."provider_message_id", OLD."completed_at",
    OLD."terminal_at", OLD."terminal_error"
  ) IS DISTINCT FROM ROW(
    NEW."status", NEW."attempt_count", NEW."first_attempt_at",
    NEW."last_attempt_at", NEW."provider_dedupe_expires_at",
    NEW."next_attempt_at",
    NEW."lease_token", NEW."lease_acquired_at", NEW."lease_expires_at",
    NEW."last_error", NEW."provider_message_id", NEW."completed_at",
    NEW."terminal_at", NEW."terminal_error"
  ) AND NEW."updated_at" <= OLD."updated_at"
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_UPDATED_AT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_jobs_protect"
  BEFORE UPDATE OR DELETE ON "calendar_sync_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_calendar_sync_job"();
