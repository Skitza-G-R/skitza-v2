-- SK-229: operator-managed account closure.
--
-- Verification immediately hides Producer/public role surfaces without
-- rewriting the immutable Clerk identity used by shared business/audit
-- records. Full access revocation is not recorded until Clerk account/session
-- evidence exists. Destructive
-- provider and object-storage work is deliberately represented as resumable
-- tasks; completion requires operator evidence rather than an optimistic flag.

DO $$
BEGIN
  IF to_regclass('public.producers') IS NULL
    OR to_regclass('skitza_migrations.applied') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "skitza_migrations"."applied"
      WHERE "filename" = '0049_producer_invitation_grants.sql'
    ) THEN
    RAISE EXCEPTION 'SKITZA_0050_REQUIRES_0049';
  END IF;
END;
$$;

ALTER TABLE "producers"
  ADD COLUMN "closed_at" timestamp with time zone;

CREATE INDEX "producers_open_slug_idx"
  ON "producers" ("slug")
  WHERE "closed_at" IS NULL;

CREATE TYPE "account_closure_status" AS ENUM (
  'requested',
  'processing',
  'blocked',
  'completed',
  'cancelled'
);

CREATE TYPE "account_closure_task_kind" AS ENUM (
  'google_calendar_disconnect',
  'device_and_artist_preferences_cleanup',
  'clerk_account_delete',
  'public_and_capability_link_revoke',
  'account_profile_deidentification',
  'storage_review_and_cleanup',
  'retained_record_review',
  'diagnostic_provider_cleanup',
  'backup_expiry_tracking'
);

CREATE TYPE "account_closure_task_status" AS ENUM (
  'pending',
  'running',
  'blocked',
  'succeeded',
  'not_applicable'
);

CREATE TYPE "account_closure_event_type" AS ENUM (
  'requested',
  'identity_verified',
  'closure_started',
  'access_revoked',
  'task_started',
  'task_blocked',
  'task_succeeded',
  'task_not_applicable',
  'legal_hold_applied',
  'legal_hold_released',
  'completed',
  'cancelled'
);

CREATE TABLE "account_closure_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_user_id" text NOT NULL,
  "requester_email_hash" text NOT NULL,
  "status" "account_closure_status" NOT NULL DEFAULT 'requested',
  "received_at" timestamp with time zone NOT NULL,
  "identity_verified_at" timestamp with time zone,
  "closure_started_at" timestamp with time zone,
  "access_revoked_at" timestamp with time zone,
  "due_at" timestamp with time zone,
  "verified_by_clerk_user_id" text,
  "legal_hold_at" timestamp with time zone,
  "legal_hold_reason_code" text,
  "legal_hold_by_clerk_user_id" text,
  "legal_hold_released_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_closure_requests_clerk_user_unique"
    UNIQUE ("clerk_user_id"),
  CONSTRAINT "account_closure_requests_identity_shape"
    CHECK (
      "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "requester_email_hash" ~ '^sha256:[0-9a-f]{64}$'
      AND (
        "verified_by_clerk_user_id" IS NULL
        OR "verified_by_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      )
      AND (
        "legal_hold_by_clerk_user_id" IS NULL
        OR "legal_hold_by_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      )
    ),
  CONSTRAINT "account_closure_requests_lifecycle_shape"
    CHECK (
      (
        "status" = 'requested'
        AND "identity_verified_at" IS NULL
        AND "closure_started_at" IS NULL
        AND "access_revoked_at" IS NULL
        AND "due_at" IS NULL
        AND "verified_by_clerk_user_id" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL
      )
      OR (
        "status" IN ('processing', 'blocked')
        AND "identity_verified_at" IS NOT NULL
        AND "closure_started_at" IS NOT NULL
        AND "due_at" = "identity_verified_at" + interval '30 days'
        AND "verified_by_clerk_user_id" IS NOT NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL
      )
      OR (
        "status" = 'completed'
        AND "identity_verified_at" IS NOT NULL
        AND "closure_started_at" IS NOT NULL
        AND "access_revoked_at" IS NOT NULL
        AND "due_at" = "identity_verified_at" + interval '30 days'
        AND "verified_by_clerk_user_id" IS NOT NULL
        AND "completed_at" >= "identity_verified_at"
        AND "cancelled_at" IS NULL
        AND ("legal_hold_at" IS NULL OR "legal_hold_released_at" IS NOT NULL)
      )
      OR (
        "status" = 'cancelled'
        AND "identity_verified_at" IS NULL
        AND "closure_started_at" IS NULL
        AND "access_revoked_at" IS NULL
        AND "due_at" IS NULL
        AND "verified_by_clerk_user_id" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NOT NULL
      )
    ),
  CONSTRAINT "account_closure_requests_legal_hold_shape"
    CHECK (
      (
        "legal_hold_at" IS NULL
        AND "legal_hold_reason_code" IS NULL
        AND "legal_hold_by_clerk_user_id" IS NULL
        AND "legal_hold_released_at" IS NULL
      )
      OR (
        "legal_hold_at" IS NOT NULL
        AND NULLIF(btrim("legal_hold_reason_code"), '') IS NOT NULL
        AND char_length("legal_hold_reason_code") <= 100
        AND "legal_hold_reason_code" ~ '^[a-z][a-z0-9_.-]{0,99}$'
        AND "legal_hold_by_clerk_user_id" IS NOT NULL
        AND (
          "legal_hold_released_at" IS NULL
          OR "legal_hold_released_at" >= "legal_hold_at"
        )
      )
    ),
  CONSTRAINT "account_closure_requests_timestamp_shape"
    CHECK (
      "updated_at" >= "created_at"
      AND "received_at" >= "created_at"
      AND (
        "identity_verified_at" IS NULL
        OR "identity_verified_at" >= "received_at"
      )
      AND (
        "closure_started_at" IS NULL
        OR "closure_started_at" >= "identity_verified_at"
      )
      AND (
        "access_revoked_at" IS NULL
        OR "access_revoked_at" >= "closure_started_at"
      )
      AND (
        "cancelled_at" IS NULL
        OR "cancelled_at" >= "received_at"
      )
    )
);

CREATE INDEX "account_closure_requests_status_due_idx"
  ON "account_closure_requests" ("status", "due_at", "id");

CREATE INDEX "account_closure_requests_started_idx"
  ON "account_closure_requests" ("clerk_user_id", "closure_started_at")
  WHERE "closure_started_at" IS NOT NULL;

CREATE TABLE "account_closure_tasks" (
  "request_id" uuid NOT NULL,
  "kind" "account_closure_task_kind" NOT NULL,
  "status" "account_closure_task_status" NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error_code" text,
  "evidence_ref" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_closure_tasks_pk"
    PRIMARY KEY ("request_id", "kind"),
  CONSTRAINT "account_closure_tasks_request_fk"
    FOREIGN KEY ("request_id")
    REFERENCES "account_closure_requests" ("id")
    ON DELETE RESTRICT,
  CONSTRAINT "account_closure_tasks_attempt_shape"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "account_closure_tasks_result_shape"
    CHECK (
      (
        "status" = 'pending'
        AND "started_at" IS NULL
        AND "completed_at" IS NULL
        AND "last_error_code" IS NULL
        AND "evidence_ref" IS NULL
      )
      OR (
        "status" = 'running'
        AND "attempt_count" > 0
        AND "started_at" IS NOT NULL
        AND "completed_at" IS NULL
        AND "last_error_code" IS NULL
        AND "evidence_ref" IS NULL
      )
      OR (
        "status" = 'blocked'
        AND "attempt_count" > 0
        AND "started_at" IS NOT NULL
        AND "completed_at" IS NULL
        AND NULLIF(btrim("last_error_code"), '') IS NOT NULL
        AND char_length("last_error_code") <= 100
        AND "evidence_ref" IS NULL
      )
      OR (
        "status" IN ('succeeded', 'not_applicable')
        AND "started_at" IS NOT NULL
        AND "completed_at" >= "started_at"
        AND "last_error_code" IS NULL
        AND NULLIF(btrim("evidence_ref"), '') IS NOT NULL
        AND char_length("evidence_ref") <= 255
      )
    )
);

CREATE INDEX "account_closure_tasks_status_updated_idx"
  ON "account_closure_tasks" ("status", "updated_at", "request_id", "kind");

CREATE TABLE "account_closure_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "event_type" "account_closure_event_type" NOT NULL,
  "task_kind" "account_closure_task_kind",
  "actor_clerk_user_id" text NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "evidence_ref" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_closure_events_request_fk"
    FOREIGN KEY ("request_id")
    REFERENCES "account_closure_requests" ("id")
    ON DELETE RESTRICT,
  CONSTRAINT "account_closure_events_operation_unique"
    UNIQUE ("request_id", "operation_key"),
  CONSTRAINT "account_closure_events_identity_shape"
    CHECK (
      "actor_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND char_length("operation_key") <= 255
      AND "operation_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND (
        "evidence_ref" IS NULL
        OR (
          NULLIF(btrim("evidence_ref"), '') IS NOT NULL
          AND char_length("evidence_ref") <= 255
        )
      )
    ),
  CONSTRAINT "account_closure_events_task_shape"
    CHECK (
      (
        "event_type" IN (
          'task_started',
          'task_blocked',
          'task_succeeded',
          'task_not_applicable'
        )
        AND "task_kind" IS NOT NULL
      )
      OR (
        "event_type" NOT IN (
          'task_started',
          'task_blocked',
          'task_succeeded',
          'task_not_applicable'
        )
        AND "task_kind" IS NULL
      )
    ),
  CONSTRAINT "account_closure_events_timestamp_shape"
    CHECK ("created_at" >= "occurred_at")
);

CREATE INDEX "account_closure_events_request_occurred_idx"
  ON "account_closure_events" ("request_id", "occurred_at", "id");

CREATE TRIGGER "account_closure_events_append_only"
  BEFORE UPDATE OR DELETE ON "account_closure_events"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE OR REPLACE FUNCTION "prevent_closed_producer_reopen"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL
    AND (NEW.closed_at IS NULL OR NEW.closed_at <> OLD.closed_at) THEN
    RAISE EXCEPTION 'closed producer access is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "producers_closed_at_one_way"
  BEFORE UPDATE OF "closed_at" ON "producers"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_closed_producer_reopen"();
