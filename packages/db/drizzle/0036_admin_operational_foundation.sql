-- SK-132: additive founder-admin safety and operational-data foundations.
-- All records are explicitly scoped to Live or Test. History and event rows
-- are immutable, and retry identities include their environment.

CREATE TYPE "admin_data_environment" AS ENUM ('live', 'test');
CREATE TYPE "admin_action_outcome" AS ENUM (
  'succeeded',
  'failed',
  'partial',
  'no_change'
);
CREATE TYPE "admin_sensitive_reveal_reason" AS ENUM (
  'support_investigation',
  'safety_issue'
);
CREATE TYPE "operational_run_kind" AS ENUM (
  'job',
  'email',
  'webhook',
  'provider_investigation'
);
CREATE TYPE "operational_run_status" AS ENUM (
  'running',
  'succeeded',
  'failed',
  'partial'
);
CREATE TYPE "system_problem_state" AS ENUM ('new', 'seen', 'resolved');

CREATE OR REPLACE FUNCTION "skitza_is_safe_admin_json"(
  value jsonb,
  allowed_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object' THEN false
    WHEN cardinality(allowed_keys) = 0 THEN false
    WHEN (
      SELECT count(*) FROM jsonb_object_keys(value)
    ) > least(16, cardinality(allowed_keys)) THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) AS entry
      WHERE entry.key !~ '^[A-Za-z][A-Za-z0-9]{0,63}$'
        OR NOT (entry.key = ANY(allowed_keys))
        OR jsonb_typeof(entry.value)
          NOT IN ('string', 'number', 'boolean', 'null')
        OR (
          jsonb_typeof(entry.value) = 'string'
          AND (
            char_length(entry.value #>> '{}') > 200
            OR entry.value #>> '{}'
              !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
          )
        )
        OR (
          jsonb_typeof(entry.value) = 'number'
          AND abs((entry.value #>> '{}')::numeric) > 9007199254740991
        )
    )
  END;
$$;

CREATE TABLE "admin_action_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "action" text NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "result_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_action_receipts_environment_action_operation_unique"
    UNIQUE ("environment", "action", "operation_key"),
  CONSTRAINT "admin_action_receipts_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "admin_action_receipts_identity_shape"
    CHECK (
      NULLIF(btrim("action"), '') IS NOT NULL
      AND char_length("action") <= 100
      AND NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND char_length("operation_key") <= 255
      AND NULLIF(btrim("result_id"), '') IS NOT NULL
      AND char_length("result_id") <= 255
    ),
  CONSTRAINT "admin_action_receipts_digest_shape"
    CHECK ("operation_digest" ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX "admin_action_receipts_environment_created_idx"
  ON "admin_action_receipts" ("environment", "created_at" DESC, "id");

CREATE TABLE "admin_action_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "actor_clerk_user_id" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "target_account_clerk_user_id" text,
  "action" text NOT NULL,
  "safe_before_state" jsonb,
  "safe_after_state" jsonb,
  "reveal_reason" "admin_sensitive_reveal_reason",
  "reveal_content_kind" text,
  "outcome" "admin_action_outcome" NOT NULL,
  "failure_code" text,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_action_history_environment_operation_unique"
    UNIQUE ("environment", "action", "operation_key"),
  CONSTRAINT "admin_action_history_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "admin_action_history_actor_shape"
    CHECK (
      NULLIF(btrim("actor_clerk_user_id"), '') IS NOT NULL
      AND (
        "target_account_clerk_user_id" IS NULL
        OR NULLIF(btrim("target_account_clerk_user_id"), '') IS NOT NULL
      )
    ),
  CONSTRAINT "admin_action_history_target_shape"
    CHECK (
      NULLIF(btrim("target_type"), '') IS NOT NULL
      AND NULLIF(btrim("target_id"), '') IS NOT NULL
      AND NULLIF(btrim("action"), '') IS NOT NULL
    ),
  CONSTRAINT "admin_action_history_operation_shape"
    CHECK (NULLIF(btrim("operation_key"), '') IS NOT NULL),
  CONSTRAINT "admin_action_history_digest_shape"
    CHECK ("operation_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "admin_action_history_safe_state_shape"
    CHECK (
      (
        "safe_before_state" IS NULL
        OR (
          "action" = 'system_problem.update'
          AND skitza_is_safe_admin_json(
            "safe_before_state",
            ARRAY['hasPrivateNote', 'state']
          )
          AND COALESCE(
            jsonb_typeof("safe_before_state" -> 'hasPrivateNote') = 'boolean',
            false
          )
          AND COALESCE(
            "safe_before_state" ->> 'state' IN ('new', 'seen', 'resolved'),
            false
          )
        )
      )
      AND (
        "safe_after_state" IS NULL
        OR (
          "action" = 'support_note.create'
          AND skitza_is_safe_admin_json(
            "safe_after_state",
            ARRAY['noteCreated']
          )
          AND "safe_after_state" = '{"noteCreated": true}'::jsonb
        )
        OR (
          "action" = 'system_problem.update'
          AND skitza_is_safe_admin_json(
            "safe_after_state",
            ARRAY['hasPrivateNote', 'state']
          )
          AND COALESCE(
            jsonb_typeof("safe_after_state" -> 'hasPrivateNote') = 'boolean',
            false
          )
          AND COALESCE(
            "safe_after_state" ->> 'state' IN ('new', 'seen', 'resolved'),
            false
          )
        )
      )
    ),
  CONSTRAINT "admin_action_history_reveal_shape"
    CHECK (
      (
        "action" = 'sensitive_content.reveal'
        AND "reveal_reason" IS NOT NULL
        AND NULLIF(btrim("reveal_content_kind"), '') IS NOT NULL
        AND char_length("reveal_content_kind") <= 100
        AND "reveal_content_kind" ~ '^[a-z][a-z0-9_.-]{0,99}$'
        AND "outcome" = 'succeeded'
        AND "failure_code" IS NULL
        AND "safe_before_state" IS NULL
        AND "safe_after_state" IS NULL
      )
      OR (
        "action" <> 'sensitive_content.reveal'
        AND "reveal_reason" IS NULL
        AND "reveal_content_kind" IS NULL
      )
    ),
  CONSTRAINT "admin_action_history_failure_shape"
    CHECK (
      "failure_code" IS NULL
      OR NULLIF(btrim("failure_code"), '') IS NOT NULL
    )
);

CREATE INDEX "admin_action_history_environment_occurred_idx"
  ON "admin_action_history" ("environment", "occurred_at" DESC, "id");

CREATE INDEX "admin_action_history_target_occurred_idx"
  ON "admin_action_history" (
    "environment",
    "target_type",
    "target_id",
    "occurred_at" DESC,
    "id"
  );

CREATE TABLE "admin_support_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "body" text NOT NULL,
  "created_by_clerk_user_id" text NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_support_notes_environment_operation_unique"
    UNIQUE ("environment", "operation_key"),
  CONSTRAINT "admin_support_notes_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "admin_support_notes_target_shape"
    CHECK (
      NULLIF(btrim("target_type"), '') IS NOT NULL
      AND NULLIF(btrim("target_id"), '') IS NOT NULL
      AND NULLIF(btrim("created_by_clerk_user_id"), '') IS NOT NULL
    ),
  CONSTRAINT "admin_support_notes_body_shape"
    CHECK (
      NULLIF(btrim("body"), '') IS NOT NULL
      AND char_length("body") <= 10000
    ),
  CONSTRAINT "admin_support_notes_operation_shape"
    CHECK (NULLIF(btrim("operation_key"), '') IS NOT NULL),
  CONSTRAINT "admin_support_notes_digest_shape"
    CHECK ("operation_digest" ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX "admin_support_notes_target_created_idx"
  ON "admin_support_notes" (
    "environment",
    "target_type",
    "target_id",
    "created_at" DESC,
    "id"
  );

CREATE TABLE "domain_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "event_name" text NOT NULL,
  "event_version" integer DEFAULT 1 NOT NULL,
  "producer_id" uuid,
  "actor_clerk_user_id" text,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "domain_events_environment_operation_unique"
    UNIQUE ("environment", "event_name", "operation_key"),
  CONSTRAINT "domain_events_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "domain_events_event_shape"
    CHECK (
      NULLIF(btrim("event_name"), '') IS NOT NULL
      AND (
        "actor_clerk_user_id" IS NULL
        OR NULLIF(btrim("actor_clerk_user_id"), '') IS NOT NULL
      )
    ),
  CONSTRAINT "domain_events_positive_version"
    CHECK ("event_version" > 0),
  CONSTRAINT "domain_events_target_shape"
    CHECK (
      NULLIF(btrim("target_type"), '') IS NOT NULL
      AND NULLIF(btrim("target_id"), '') IS NOT NULL
    ),
  CONSTRAINT "domain_events_operation_shape"
    CHECK (NULLIF(btrim("operation_key"), '') IS NOT NULL),
  CONSTRAINT "domain_events_digest_shape"
    CHECK ("operation_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "domain_events_safe_metadata_shape"
    CHECK (
      skitza_is_safe_admin_json(
        "safe_metadata",
        ARRAY['changed', 'fieldCount']
      )
      AND (
        NOT ("safe_metadata" ? 'changed')
        OR jsonb_typeof("safe_metadata" -> 'changed') = 'boolean'
      )
      AND CASE
        WHEN "safe_metadata" ? 'fieldCount' THEN
          CASE
            WHEN jsonb_typeof("safe_metadata" -> 'fieldCount') = 'number'
            THEN (
              ("safe_metadata" ->> 'fieldCount')::numeric >= 0
              AND ("safe_metadata" ->> 'fieldCount')::numeric
                = trunc(("safe_metadata" ->> 'fieldCount')::numeric)
            )
            ELSE false
          END
        ELSE true
      END
    )
);

CREATE INDEX "domain_events_environment_occurred_idx"
  ON "domain_events" ("environment", "occurred_at" DESC, "id");

CREATE INDEX "domain_events_producer_occurred_idx"
  ON "domain_events" ("environment", "producer_id", "occurred_at" DESC, "id");

CREATE INDEX "domain_events_target_occurred_idx"
  ON "domain_events" (
    "environment",
    "target_type",
    "target_id",
    "occurred_at" DESC,
    "id" DESC
  );

CREATE INDEX "domain_events_actor_occurred_idx"
  ON "domain_events" (
    "environment",
    "actor_clerk_user_id",
    "occurred_at" DESC,
    "id" DESC
  )
  WHERE "actor_clerk_user_id" IS NOT NULL;

CREATE TABLE "operational_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "kind" "operational_run_kind" NOT NULL,
  "operation_name" text NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "target_type" text,
  "target_id" text,
  "provider" text,
  "provider_reference" text,
  "safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "operational_run_status" DEFAULT 'running' NOT NULL,
  "error_code" text,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operational_runs_environment_operation_attempt_unique"
    UNIQUE (
      "environment",
      "kind",
      "operation_name",
      "operation_key",
      "attempt_number"
    ),
  CONSTRAINT "operational_runs_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "operational_runs_operation_shape"
    CHECK (
      NULLIF(btrim("operation_name"), '') IS NOT NULL
      AND NULLIF(btrim("operation_key"), '') IS NOT NULL
    ),
  CONSTRAINT "operational_runs_digest_shape"
    CHECK ("operation_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "operational_runs_positive_attempt"
    CHECK ("attempt_number" > 0),
  CONSTRAINT "operational_runs_target_shape"
    CHECK (
      ("target_type" IS NULL AND "target_id" IS NULL)
      OR (
        NULLIF(btrim("target_type"), '') IS NOT NULL
        AND NULLIF(btrim("target_id"), '') IS NOT NULL
      )
    ),
  CONSTRAINT "operational_runs_provider_shape"
    CHECK (
      (
        "provider" IS NULL
        OR NULLIF(btrim("provider"), '') IS NOT NULL
      )
      AND (
        "provider_reference" IS NULL
        OR (
          "provider" IS NOT NULL
          AND NULLIF(btrim("provider_reference"), '') IS NOT NULL
        )
      )
    ),
  CONSTRAINT "operational_runs_safe_metadata_shape"
    CHECK (
      skitza_is_safe_admin_json(
        "safe_metadata",
        ARRAY['batchSize', 'durationMs']
      )
      AND CASE
        WHEN "safe_metadata" ? 'batchSize' THEN
          CASE
            WHEN jsonb_typeof("safe_metadata" -> 'batchSize') = 'number'
            THEN (
              ("safe_metadata" ->> 'batchSize')::numeric >= 0
              AND ("safe_metadata" ->> 'batchSize')::numeric
                = trunc(("safe_metadata" ->> 'batchSize')::numeric)
            )
            ELSE false
          END
        ELSE true
      END
      AND CASE
        WHEN "safe_metadata" ? 'durationMs' THEN
          CASE
            WHEN jsonb_typeof("safe_metadata" -> 'durationMs') = 'number'
            THEN (
              ("safe_metadata" ->> 'durationMs')::numeric >= 0
              AND ("safe_metadata" ->> 'durationMs')::numeric
                = trunc(("safe_metadata" ->> 'durationMs')::numeric)
            )
            ELSE false
          END
        ELSE true
      END
    ),
  CONSTRAINT "operational_runs_status_shape"
    CHECK (
      (
        (
          "status" = 'running'
          AND "finished_at" IS NULL
          AND "error_code" IS NULL
          AND "provider_reference" IS NULL
        )
        OR (
          "status" IN ('succeeded', 'failed', 'partial')
          AND "finished_at" IS NOT NULL
          AND "finished_at" >= greatest("started_at", "created_at")
          AND (
            (
              "status" = 'succeeded'
              AND "error_code" IS NULL
            )
            OR (
              "status" IN ('failed', 'partial')
              AND NULLIF(btrim("error_code"), '') IS NOT NULL
              AND "error_code" ~ '^[a-z][a-z0-9_.-]{0,99}$'
            )
          )
        )
      )
      AND "created_at" >= "started_at"
      AND "updated_at" >= COALESCE("finished_at", "created_at")
    )
);

CREATE INDEX "operational_runs_environment_started_idx"
  ON "operational_runs" ("environment", "started_at" DESC, "id");

CREATE INDEX "operational_runs_target_started_idx"
  ON "operational_runs" (
    "environment",
    "target_type",
    "target_id",
    "started_at" DESC,
    "id"
  );

CREATE INDEX "operational_runs_environment_kind_status_idx"
  ON "operational_runs" (
    "environment",
    "kind",
    "status",
    "started_at" DESC,
    "id" DESC
  );

CREATE TABLE "system_problems" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment" "admin_data_environment" NOT NULL,
  "fingerprint" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "status" "system_problem_state" DEFAULT 'new' NOT NULL,
  "private_note" text,
  "provider" text,
  "provider_reference" text,
  "first_observed_at" timestamp with time zone NOT NULL,
  "last_observed_at" timestamp with time zone NOT NULL,
  "seen_at" timestamp with time zone,
  "seen_by_clerk_user_id" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_clerk_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_problems_environment_fingerprint_unique"
    UNIQUE ("environment", "fingerprint"),
  CONSTRAINT "system_problems_environment_shape"
    CHECK ("environment" IN ('live', 'test')),
  CONSTRAINT "system_problems_fingerprint_shape"
    CHECK ("fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "system_problems_identity_shape"
    CHECK (
      NULLIF(btrim("category"), '') IS NOT NULL
      AND NULLIF(btrim("title"), '') IS NOT NULL
      AND (
        "private_note" IS NULL
        OR (
          NULLIF(btrim("private_note"), '') IS NOT NULL
          AND char_length("private_note") <= 10000
        )
      )
    ),
  CONSTRAINT "system_problems_provider_shape"
    CHECK (
      (
        "provider" IS NULL
        OR NULLIF(btrim("provider"), '') IS NOT NULL
      )
      AND (
        "provider_reference" IS NULL
        OR (
          "provider" IS NOT NULL
          AND NULLIF(btrim("provider_reference"), '') IS NOT NULL
        )
      )
    ),
  CONSTRAINT "system_problems_observation_shape"
    CHECK (
      "last_observed_at" >= "first_observed_at"
      AND "created_at" >= "first_observed_at"
      AND "updated_at" >= greatest("created_at", "last_observed_at")
      AND ("seen_at" IS NULL OR "seen_at" >= "created_at")
      AND ("seen_at" IS NULL OR "updated_at" >= "seen_at")
      AND ("resolved_at" IS NULL OR "resolved_at" >= "created_at")
      AND ("resolved_at" IS NULL OR "updated_at" >= "resolved_at")
    ),
  CONSTRAINT "system_problems_state_shape"
    CHECK (
      (
        "status" = 'new'
        AND "seen_at" IS NULL
        AND "seen_by_clerk_user_id" IS NULL
        AND "resolved_at" IS NULL
        AND "resolved_by_clerk_user_id" IS NULL
      )
      OR (
        "status" = 'seen'
        AND "seen_at" IS NOT NULL
        AND "seen_at" >= "first_observed_at"
        AND NULLIF(btrim("seen_by_clerk_user_id"), '') IS NOT NULL
        AND "resolved_at" IS NULL
        AND "resolved_by_clerk_user_id" IS NULL
      )
      OR (
        "status" = 'resolved'
        AND (
          ("seen_at" IS NULL AND "seen_by_clerk_user_id" IS NULL)
          OR (
            "seen_at" IS NOT NULL
            AND "seen_at" >= "first_observed_at"
            AND NULLIF(btrim("seen_by_clerk_user_id"), '') IS NOT NULL
          )
        )
        AND "resolved_at" IS NOT NULL
        AND "resolved_at" >= "first_observed_at"
        AND "resolved_at" >= "last_observed_at"
        AND ("seen_at" IS NULL OR "resolved_at" >= "seen_at")
        AND NULLIF(btrim("resolved_by_clerk_user_id"), '') IS NOT NULL
      )
    )
);

CREATE INDEX "system_problems_environment_status_idx"
  ON "system_problems" (
    "environment",
    "status",
    "last_observed_at" DESC,
    "id"
  );

CREATE TRIGGER "admin_action_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "admin_action_receipts"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE OR REPLACE FUNCTION "skitza_guard_admin_action_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    TG_OP = 'DELETE'
    AND current_setting('skitza.admin_history_purge', true) = 'enabled'
    AND OLD."occurred_at" < statement_timestamp() - interval '90 days'
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'SKITZA_ADMIN_ACTION_HISTORY_IMMUTABLE';
END;
$$;

CREATE TRIGGER "admin_action_history_immutable"
  BEFORE UPDATE OR DELETE ON "admin_action_history"
  FOR EACH ROW EXECUTE FUNCTION "skitza_guard_admin_action_history"();

CREATE OR REPLACE FUNCTION "purge_expired_admin_action_history"(
  p_environment "admin_data_environment"
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  IF p_environment IS NULL THEN
    RAISE EXCEPTION 'SKITZA_ADMIN_HISTORY_PURGE_ENVIRONMENT_REQUIRED';
  END IF;

  PERFORM set_config('skitza.admin_history_purge', 'enabled', true);

  DELETE FROM "admin_action_history"
  WHERE "environment" = p_environment
    AND "occurred_at" < statement_timestamp() - interval '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  PERFORM set_config('skitza.admin_history_purge', 'disabled', true);

  RETURN deleted_count;
END;
$$;

-- Note text is immutable, but DELETE remains available for the future
-- transactional workspace-deletion service. SK-132 exposes no note-delete API.
CREATE OR REPLACE FUNCTION "skitza_guard_admin_support_note_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SKITZA_ADMIN_SUPPORT_NOTE_IMMUTABLE';
END;
$$;

CREATE TRIGGER "admin_support_notes_immutable"
  BEFORE UPDATE ON "admin_support_notes"
  FOR EACH ROW EXECUTE FUNCTION "skitza_guard_admin_support_note_update"();

CREATE TRIGGER "domain_events_append_only"
  BEFORE UPDATE OR DELETE ON "domain_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE OR REPLACE FUNCTION "skitza_guard_operational_run"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (
      NEW."status" <> 'running'
      OR NEW."finished_at" IS NOT NULL
      OR NEW."error_code" IS NOT NULL
      OR NEW."provider_reference" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SKITZA_OPERATIONAL_RUN_INITIAL_STATE';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_OPERATIONAL_RUN_TERMINAL';
  END IF;

  IF ROW(
    NEW."id",
    NEW."environment",
    NEW."kind",
    NEW."operation_name",
    NEW."operation_key",
    NEW."operation_digest",
    NEW."attempt_number",
    NEW."target_type",
    NEW."target_id",
    NEW."provider",
    NEW."started_at",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."environment",
    OLD."kind",
    OLD."operation_name",
    OLD."operation_key",
    OLD."operation_digest",
    OLD."attempt_number",
    OLD."target_type",
    OLD."target_id",
    OLD."provider",
    OLD."started_at",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_OPERATIONAL_RUN_INTENT_IMMUTABLE';
  END IF;

  IF OLD."status" <> 'running' OR NEW."status" = 'running' THEN
    RAISE EXCEPTION 'SKITZA_OPERATIONAL_RUN_TERMINAL';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_OPERATIONAL_RUN_UPDATE_REGRESSION';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "operational_runs_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "operational_runs"
  FOR EACH ROW EXECUTE FUNCTION "skitza_guard_operational_run"();

CREATE OR REPLACE FUNCTION "skitza_guard_system_problem"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (
      NEW."status" <> 'new'
      OR NEW."seen_at" IS NOT NULL
      OR NEW."seen_by_clerk_user_id" IS NOT NULL
      OR NEW."resolved_at" IS NOT NULL
      OR NEW."resolved_by_clerk_user_id" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_INITIAL_STATE';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_DELETE_FORBIDDEN';
  END IF;

  IF ROW(
    NEW."id",
    NEW."environment",
    NEW."fingerprint",
    NEW."category",
    NEW."first_observed_at",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."environment",
    OLD."fingerprint",
    OLD."category",
    OLD."first_observed_at",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW."last_observed_at" < OLD."last_observed_at" THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_OBSERVATION_REGRESSION';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_UPDATE_REGRESSION';
  END IF;

  IF OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF OLD."status" = 'resolved' AND NEW."status" = 'new' THEN
      IF NEW."last_observed_at"
        <= greatest(OLD."last_observed_at", OLD."resolved_at")
      THEN
        RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_RECURRENCE_REQUIRED';
      END IF;
    ELSIF (
      OLD."status" = 'new'
      AND NEW."status" IN ('seen', 'resolved')
    ) OR (
      OLD."status" = 'seen'
      AND NEW."status" = 'resolved'
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_STATE_TRANSITION';
    END IF;
  END IF;

  IF (
    OLD."status" IN ('seen', 'resolved')
    AND NOT (
      OLD."status" = 'resolved'
      AND NEW."status" = 'new'
    )
    AND ROW(NEW."seen_at", NEW."seen_by_clerk_user_id")
      IS DISTINCT FROM ROW(OLD."seen_at", OLD."seen_by_clerk_user_id")
  ) THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_SEEN_IMMUTABLE';
  END IF;

  IF (
    OLD."status" = 'resolved'
    AND NEW."status" <> 'new'
    AND ROW(NEW."resolved_at", NEW."resolved_by_clerk_user_id")
      IS DISTINCT FROM ROW(OLD."resolved_at", OLD."resolved_by_clerk_user_id")
  ) THEN
    RAISE EXCEPTION 'SKITZA_SYSTEM_PROBLEM_RESOLUTION_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "system_problems_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "system_problems"
  FOR EACH ROW EXECUTE FUNCTION "skitza_guard_system_problem"();
