-- SK-195 adds privacy-safe Google watch channels and known-link inbound
-- reconciliation to the existing leased calendar outbox. It stores no raw
-- channel token, raw calendar ID, unrelated event data, or provider payload.

ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_payload_shape";

ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_channel_shape";

DROP INDEX "calendar_sync_jobs_link_channel_revision_unique";

-- Rebuild the operation enum so the new value is usable in this same atomic
-- migration transaction.
ALTER TYPE "calendar_sync_job_operation"
  RENAME TO "calendar_sync_job_operation_legacy";

CREATE TYPE "calendar_sync_job_operation" AS ENUM (
  'send_ics',
  'upsert_google_event',
  'delete_google_event',
  'reconcile_google_event'
);

ALTER TABLE "calendar_sync_jobs"
  ALTER COLUMN "operation" TYPE "calendar_sync_job_operation"
  USING "operation"::text::"calendar_sync_job_operation";

DROP TYPE "calendar_sync_job_operation_legacy";

CREATE TYPE "booking_calendar_link_sync_state" AS ENUM (
  'pending',
  'synced',
  'not_synced',
  'conflict',
  'missing',
  'disconnected'
);

CREATE TYPE "google_calendar_watch_state" AS ENUM (
  'renewing',
  'active',
  'retired',
  'expired'
);

CREATE TYPE "google_calendar_sync_error_code" AS ENUM (
  'provider_unavailable',
  'rate_limited',
  'permission_denied',
  'reconnect_required',
  'invalid_provider_event',
  'stale_skitza_revision',
  'skitza_overlap',
  'watch_create_failed',
  'watch_renew_failed',
  'watch_stop_failed',
  'reconciliation_failed',
  'unknown'
);

ALTER TABLE "booking_calendar_links"
  ADD COLUMN "provider_event_updated_at" timestamp with time zone,
  ADD COLUMN "sync_state" "booking_calendar_link_sync_state" DEFAULT 'pending' NOT NULL,
  ADD COLUMN "sync_state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "last_inbound_reconciled_at" timestamp with time zone,
  ADD COLUMN "last_sync_error_code" "google_calendar_sync_error_code";

ALTER TABLE "booking_calendar_links"
  ADD CONSTRAINT "booking_calendar_links_sync_state_shape" CHECK ((
    (
      "sync_state" IN ('pending', 'synced', 'missing', 'disconnected')
      AND "last_sync_error_code" IS NULL
    )
    OR (
      "sync_state" = 'conflict'
      AND "last_sync_error_code" IN ('stale_skitza_revision', 'skitza_overlap')
    )
    OR (
      "sync_state" = 'not_synced'
      AND "last_sync_error_code" IS NOT NULL
      AND "last_sync_error_code" NOT IN ('stale_skitza_revision', 'skitza_overlap')
    )
  ) IS TRUE);

ALTER TABLE "booking_calendar_links"
  DROP CONSTRAINT "booking_calendar_links_timestamp_shape";

ALTER TABLE "booking_calendar_links"
  ADD CONSTRAINT "booking_calendar_links_timestamp_shape" CHECK ((
    "updated_at" >= "created_at"
    AND "sync_state_changed_at" >= "created_at"
    AND (
      "last_inbound_reconciled_at" IS NULL
      OR "last_inbound_reconciled_at" >= "created_at"
    )
    AND (
      "last_google_synced_at" IS NULL
      OR "last_google_synced_at" >= "created_at"
    )
    AND (
      "invitation_reserved_at" IS NULL
      OR "invitation_reserved_at" >= "created_at"
    )
    AND (
      "invitation_attempted_at" IS NULL
      OR "invitation_attempted_at" >= "created_at"
    )
    AND (
      "invitation_delivered_at" IS NULL
      OR "invitation_delivered_at" >= "created_at"
    )
  ) IS TRUE);

DROP INDEX "booking_calendar_links_reconciliation_idx";

CREATE INDEX "booking_calendar_links_reconciliation_idx"
  ON "booking_calendar_links" (
    "connection_id",
    "account_version",
    "provider_state",
    "sync_state",
    "last_inbound_reconciled_at",
    "desired_revision",
    "id"
  );

-- A renewing row is reserved before the provider call. Resource identity and
-- expiration remain NULL until Google returns. The initial sync notification
-- may race that response and is safely ignored until both trust facts exist.
CREATE TABLE "google_calendar_watches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "account_version" integer NOT NULL,
  "destination_selection_id" uuid NOT NULL,
  "destination_calendar_id_ciphertext" text NOT NULL,
  "destination_calendar_id_iv" text NOT NULL,
  "destination_calendar_id_auth_tag" text NOT NULL,
  "destination_calendar_id_key_version" integer NOT NULL,
  "destination_calendar_id_fingerprint" text NOT NULL,
  "renewal_of_watch_id" uuid,
  "provider_channel_id" uuid NOT NULL,
  "provider_resource_id" text,
  "channel_token_digest" text NOT NULL,
  "state" "google_calendar_watch_state" DEFAULT 'renewing' NOT NULL,
  "expires_at" timestamp with time zone,
  "last_message_number" text DEFAULT '0' NOT NULL,
  "last_notification_at" timestamp with time zone,
  "last_reconciled_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "last_error_code" "google_calendar_sync_error_code",
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_calendar_watches_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "google_calendar_watches_channel_unique"
    UNIQUE ("provider_channel_id"),
  -- Deliberately omit account_version from this FK. Historical watches must
  -- survive, and must not prevent an explicit Google account-version switch.
  CONSTRAINT "google_calendar_watches_connection_producer_fk"
    FOREIGN KEY ("connection_id", "producer_id")
    REFERENCES "google_calendar_connections" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "google_calendar_watches_renewal_producer_fk"
    FOREIGN KEY ("renewal_of_watch_id", "producer_id")
    REFERENCES "google_calendar_watches" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "google_calendar_watches_encrypted_destination_shape" CHECK ((
    "destination_calendar_id_ciphertext" ~ '^[A-Za-z0-9_-]+$'
    AND char_length("destination_calendar_id_ciphertext") <= 8192
    AND "destination_calendar_id_iv" ~ '^[A-Za-z0-9_-]{16}$'
    AND "destination_calendar_id_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'
    AND "destination_calendar_id_key_version" > 0
    AND "destination_calendar_id_fingerprint" ~ '^hmac-sha256:[0-9a-f]{64}$'
  ) IS TRUE),
  CONSTRAINT "google_calendar_watches_trust_shape" CHECK ((
    "account_version" > 0
    AND "channel_token_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND (
      "provider_resource_id" IS NULL
      OR (
        NULLIF(btrim("provider_resource_id"), '') IS NOT NULL
        AND "provider_resource_id" !~ '[[:space:]]'
        AND char_length("provider_resource_id") <= 2048
      )
    )
    AND "last_message_number" ~ '^(0|[1-9][0-9]{0,38})$'
  ) IS TRUE),
  CONSTRAINT "google_calendar_watches_state_shape" CHECK ((
    (
      "state" = 'renewing'
      AND "activated_at" IS NULL
      AND "ended_at" IS NULL
      AND "last_error_code" IS NULL
      AND (
        ("provider_resource_id" IS NULL AND "expires_at" IS NULL)
        OR ("provider_resource_id" IS NOT NULL AND "expires_at" IS NOT NULL)
      )
    )
    OR (
      "state" = 'active'
      AND "provider_resource_id" IS NOT NULL
      AND "expires_at" IS NOT NULL
      AND "activated_at" IS NOT NULL
      AND "ended_at" IS NULL
      AND "last_error_code" IS NULL
    )
    OR (
      "state" IN ('retired', 'expired')
      AND "ended_at" IS NOT NULL
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_watches_message_shape" CHECK ((
    ("last_message_number" = '0' AND "last_notification_at" IS NULL)
    OR ("last_message_number" <> '0' AND "last_notification_at" IS NOT NULL)
  ) IS TRUE),
  CONSTRAINT "google_calendar_watches_timestamp_shape" CHECK ((
    "updated_at" >= "created_at"
    AND ("expires_at" IS NULL OR "expires_at" > "created_at")
    AND ("activated_at" IS NULL OR "activated_at" >= "created_at")
    AND ("ended_at" IS NULL OR "ended_at" >= "created_at")
    AND ("ended_at" IS NULL OR "activated_at" IS NULL OR "ended_at" >= "activated_at")
    AND ("last_notification_at" IS NULL OR "last_notification_at" >= "created_at")
    AND ("last_reconciled_at" IS NULL OR "last_reconciled_at" >= "created_at")
  ) IS TRUE)
);

CREATE UNIQUE INDEX "google_calendar_watches_one_active"
  ON "google_calendar_watches" (
    "connection_id", "account_version", "destination_calendar_id_fingerprint"
  )
  WHERE "state" = 'active';

CREATE UNIQUE INDEX "google_calendar_watches_one_renewing"
  ON "google_calendar_watches" (
    "connection_id", "account_version", "destination_calendar_id_fingerprint"
  )
  WHERE "state" = 'renewing';

CREATE INDEX "google_calendar_watches_renewal_due_idx"
  ON "google_calendar_watches" ("state", "expires_at", "id");

CREATE INDEX "google_calendar_watches_webhook_lookup_idx"
  ON "google_calendar_watches" ("provider_channel_id", "state");

ALTER TABLE "calendar_sync_jobs"
  ADD COLUMN "google_calendar_watch_id" uuid,
  ADD COLUMN "webhook_message_number" text;

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_google_calendar_watch_producer_fk"
  FOREIGN KEY ("google_calendar_watch_id", "producer_id")
  REFERENCES "google_calendar_watches" ("id", "producer_id")
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX "calendar_sync_jobs_link_outbound_revision_unique"
  ON "calendar_sync_jobs" ("booking_calendar_link_id", "desired_revision")
  WHERE "booking_calendar_link_id" IS NOT NULL
    AND "operation" IN ('upsert_google_event', 'delete_google_event');

CREATE UNIQUE INDEX "calendar_sync_jobs_watch_message_link_unique"
  ON "calendar_sync_jobs" (
    "google_calendar_watch_id", "webhook_message_number", "booking_calendar_link_id"
  )
  WHERE "operation" = 'reconcile_google_event'
    AND "google_calendar_watch_id" IS NOT NULL;

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_channel_shape" CHECK ((
    (
      "operation" = 'send_ics'
      AND "delivery_channel" = 'ics'
    )
    OR (
      "operation" IN (
        'upsert_google_event', 'delete_google_event', 'reconcile_google_event'
      )
      AND "delivery_channel" = 'google'
      AND "booking_calendar_link_id" IS NOT NULL
    )
  ) IS TRUE);

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_payload_shape" CHECK ((
    jsonb_typeof("payload_snapshot") = 'object'
    AND (
      (
        "operation" = 'send_ics'
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
        AND NULLIF(btrim("payload_snapshot"->'organizer'->>'name'), '') IS NOT NULL
        AND NULLIF(btrim("payload_snapshot"->'organizer'->>'email'), '') IS NOT NULL
        AND jsonb_typeof("payload_snapshot"->'attendee') = 'object'
        AND NULLIF(btrim("payload_snapshot"->'attendee'->>'name'), '') IS NOT NULL
        AND NULLIF(btrim("payload_snapshot"->'attendee'->>'email'), '') IS NOT NULL
      )
      OR (
        "operation" IN ('upsert_google_event', 'delete_google_event')
        AND "payload_snapshot"->>'schemaVersion' = '2'
        AND ("payload_snapshot"->>'sequence') ~ '^[0-9]+$'
        AND ("payload_snapshot"->>'sequence')::integer = "desired_revision"
        AND jsonb_typeof("payload_snapshot"->'privateProperties') = 'object'
        AND (("payload_snapshot"->'privateProperties') - ARRAY[
          'skitzaLink', 'skitzaRevision', 'skitzaSchema'
        ]::text[]) = '{}'::jsonb
        AND "payload_snapshot"->'privateProperties'->>'skitzaLink'
          = "booking_calendar_link_id"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaRevision'
          = "desired_revision"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaSchema' = '1'
        AND (
          (
            "operation" = 'upsert_google_event'
            AND "payload_snapshot"->>'action' = 'upsert'
            AND ("payload_snapshot" - ARRAY[
              'schemaVersion', 'action', 'eventKind', 'notificationMode', 'sequence',
              'startsAtUtc', 'endsAtUtc', 'summary', 'artistSafeUrl',
              'attendee', 'privateProperties'
            ]::text[]) = '{}'::jsonb
            AND "payload_snapshot"->>'eventKind' IN ('opaque_hold', 'confirmed')
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
            AND NULLIF(btrim("payload_snapshot"->>'startsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'startsAtUtc') <= 64
            AND NULLIF(btrim("payload_snapshot"->>'endsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'endsAtUtc') <= 64
            AND "payload_snapshot"->>'endsAtUtc' <> "payload_snapshot"->>'startsAtUtc'
            AND NULLIF(btrim("payload_snapshot"->>'summary'), '') IS NOT NULL
            AND char_length("payload_snapshot"->>'summary') <= 1024
            AND (
              (
                "payload_snapshot"->>'eventKind' = 'opaque_hold'
                AND "payload_snapshot"->>'summary' = 'Reserved'
                AND "payload_snapshot"->>'notificationMode' = 'none'
                AND jsonb_typeof("payload_snapshot"->'artistSafeUrl') = 'null'
                AND jsonb_typeof("payload_snapshot"->'attendee') = 'null'
              )
              OR (
                "payload_snapshot"->>'eventKind' = 'confirmed'
                AND jsonb_typeof("payload_snapshot"->'artistSafeUrl') = 'string'
                AND "payload_snapshot"->>'artistSafeUrl' ~ '^https://[^[:space:]]+$'
                AND char_length("payload_snapshot"->>'artistSafeUrl') <= 2048
                AND jsonb_typeof("payload_snapshot"->'attendee') = 'object'
                AND (("payload_snapshot"->'attendee') - ARRAY['name', 'email']::text[])
                  = '{}'::jsonb
                AND NULLIF(btrim("payload_snapshot"->'attendee'->>'name'), '') IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'name') <= 320
                AND NULLIF(btrim("payload_snapshot"->'attendee'->>'email'), '') IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'email') <= 320
              )
            )
          )
          OR (
            "operation" = 'delete_google_event'
            AND "payload_snapshot"->>'action' = 'delete'
            AND ("payload_snapshot" - ARRAY[
              'schemaVersion', 'action', 'notificationMode', 'sequence', 'privateProperties'
            ]::text[]) = '{}'::jsonb
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
          )
        )
      )
      OR (
        "operation" = 'reconcile_google_event'
        AND "payload_snapshot"->>'schemaVersion' = '3'
        AND "payload_snapshot"->>'action' = 'reconcile'
        AND ("payload_snapshot" - ARRAY[
          'schemaVersion', 'action', 'source', 'watchId', 'messageNumber'
        ]::text[]) = '{}'::jsonb
        AND "payload_snapshot"->>'source' IN ('webhook', 'recovery')
        AND (
          (
            "payload_snapshot"->>'source' = 'webhook'
            AND "google_calendar_watch_id" IS NOT NULL
            AND "webhook_message_number" ~ '^[1-9][0-9]{0,38}$'
            AND "payload_snapshot"->>'watchId' = "google_calendar_watch_id"::text
            AND "payload_snapshot"->>'messageNumber' = "webhook_message_number"
          )
          OR (
            "payload_snapshot"->>'source' = 'recovery'
            AND "google_calendar_watch_id" IS NULL
            AND "webhook_message_number" IS NULL
            AND jsonb_typeof("payload_snapshot"->'watchId') = 'null'
            AND jsonb_typeof("payload_snapshot"->'messageNumber') = 'null'
          )
        )
      )
    )
  ) IS TRUE);

-- Watch trust identity is immutable. Provider activation fills the reserved
-- resource identity exactly once; webhook and recovery watermarks may only
-- advance. A failed successor remains historical but never blocks a retry.
CREATE FUNCTION "protect_google_calendar_watch"()
RETURNS trigger AS $function$
DECLARE
  prior_message numeric;
  next_message numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_DELETE_FORBIDDEN';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'renewing' THEN
      RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_RESERVE_FIRST';
    END IF;

    PERFORM 1
    FROM "google_calendar_connections" AS connection_row
    WHERE connection_row."id" = NEW."connection_id"
      AND connection_row."producer_id" = NEW."producer_id"
      AND connection_row."account_version" = NEW."account_version"
      AND connection_row."status" = 'connected'
    FOR KEY SHARE OF connection_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_DESTINATION_INVALID';
    END IF;

    -- The current destination always needs a channel. A prior destination
    -- also remains a required target while a future confirmed linked event is
    -- still active there, so changing the destination cannot silently stop
    -- inbound updates for already-created events.
    PERFORM 1
    FROM "google_calendar_selections" AS selection_row
    WHERE selection_row."connection_id" = NEW."connection_id"
      AND selection_row."producer_id" = NEW."producer_id"
      AND selection_row."account_version" = NEW."account_version"
      AND selection_row."id" = NEW."destination_selection_id"
      AND selection_row."is_destination" = true
      AND selection_row."provider_calendar_id_ciphertext"
        = NEW."destination_calendar_id_ciphertext"
      AND selection_row."provider_calendar_id_iv"
        = NEW."destination_calendar_id_iv"
      AND selection_row."provider_calendar_id_auth_tag"
        = NEW."destination_calendar_id_auth_tag"
      AND selection_row."provider_calendar_id_key_version"
        = NEW."destination_calendar_id_key_version"
      AND selection_row."provider_calendar_id_fingerprint"
        = NEW."destination_calendar_id_fingerprint"
    FOR KEY SHARE OF selection_row;

    IF NOT FOUND THEN
      PERFORM 1
      FROM "booking_calendar_links" AS link_row
      JOIN "bookings" AS booking_row
        ON booking_row."id" = link_row."current_booking_id"
       AND booking_row."producer_id" = link_row."producer_id"
       AND booking_row."allowance_use_id" = link_row."allowance_use_id"
      WHERE link_row."producer_id" = NEW."producer_id"
        AND link_row."connection_id" = NEW."connection_id"
        AND link_row."account_version" = NEW."account_version"
        AND link_row."destination_selection_id" = NEW."destination_selection_id"
        AND link_row."destination_calendar_id_ciphertext"
          = NEW."destination_calendar_id_ciphertext"
        AND link_row."destination_calendar_id_iv"
          = NEW."destination_calendar_id_iv"
        AND link_row."destination_calendar_id_auth_tag"
          = NEW."destination_calendar_id_auth_tag"
        AND link_row."destination_calendar_id_key_version"
          = NEW."destination_calendar_id_key_version"
        AND link_row."destination_calendar_id_fingerprint"
          = NEW."destination_calendar_id_fingerprint"
        AND link_row."provider_state" = 'active'
        AND booking_row."status" IN ('pending_approval', 'confirmed')
        AND booking_row."starts_at" > CURRENT_TIMESTAMP
      FOR KEY SHARE OF link_row, booking_row;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_DESTINATION_INVALID';
    END IF;

    IF NEW."renewal_of_watch_id" IS NULL THEN
      PERFORM 1
      FROM "google_calendar_watches" AS active_watch
      WHERE active_watch."connection_id" = NEW."connection_id"
        AND active_watch."producer_id" = NEW."producer_id"
        AND active_watch."account_version" = NEW."account_version"
        AND active_watch."destination_calendar_id_fingerprint"
          = NEW."destination_calendar_id_fingerprint"
        AND active_watch."state" = 'active'
      FOR KEY SHARE OF active_watch;

      IF FOUND THEN
        RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_RENEWAL_SOURCE_REQUIRED';
      END IF;
    ELSE
      PERFORM 1
      FROM "google_calendar_watches" AS old_watch
      WHERE old_watch."id" = NEW."renewal_of_watch_id"
        AND old_watch."producer_id" = NEW."producer_id"
        AND old_watch."connection_id" = NEW."connection_id"
        AND old_watch."account_version" = NEW."account_version"
        AND old_watch."destination_calendar_id_fingerprint"
          = NEW."destination_calendar_id_fingerprint"
        AND old_watch."state" = 'active'
      FOR KEY SHARE OF old_watch;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_RENEWAL_SOURCE_INVALID';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF ROW(
    OLD."id", OLD."producer_id", OLD."connection_id", OLD."account_version",
    OLD."destination_selection_id",
    OLD."destination_calendar_id_ciphertext", OLD."destination_calendar_id_iv",
    OLD."destination_calendar_id_auth_tag", OLD."destination_calendar_id_key_version",
    OLD."destination_calendar_id_fingerprint", OLD."renewal_of_watch_id",
    OLD."provider_channel_id", OLD."channel_token_digest", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."connection_id", NEW."account_version",
    NEW."destination_selection_id",
    NEW."destination_calendar_id_ciphertext", NEW."destination_calendar_id_iv",
    NEW."destination_calendar_id_auth_tag", NEW."destination_calendar_id_key_version",
    NEW."destination_calendar_id_fingerprint", NEW."renewal_of_watch_id",
    NEW."provider_channel_id", NEW."channel_token_digest", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_UPDATED_AT_REQUIRED';
  END IF;

  IF OLD."provider_resource_id" IS NOT NULL AND ROW(
    NEW."provider_resource_id", NEW."expires_at"
  ) IS DISTINCT FROM ROW(
    OLD."provider_resource_id", OLD."expires_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_PROVIDER_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD."provider_resource_id" IS NULL AND NEW."provider_resource_id" IS NOT NULL AND (
    OLD."state" <> 'renewing'
    OR NEW."state" NOT IN ('renewing', 'active')
    OR NEW."expires_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_ACTIVATION_INVALID';
  END IF;

  IF OLD."state" = 'renewing' AND NEW."state" NOT IN (
    'renewing', 'active', 'retired', 'expired'
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_TRANSITION_INVALID';
  END IF;

  IF OLD."state" = 'active' AND NEW."state" NOT IN ('active', 'retired', 'expired') THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_TRANSITION_INVALID';
  END IF;

  IF OLD."state" IN ('retired', 'expired') AND NEW."state" <> OLD."state" THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_STATE_FINAL';
  END IF;

  IF OLD."state" IN ('retired', 'expired') AND (
    NEW."last_error_code" IS DISTINCT FROM OLD."last_error_code"
    AND NOT (
      OLD."state" = 'retired'
      AND OLD."last_error_code" IS NULL
      AND NEW."last_error_code" = 'watch_stop_failed'
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_ERROR_FINAL';
  END IF;

  prior_message := OLD."last_message_number"::numeric;
  next_message := NEW."last_message_number"::numeric;

  IF next_message < prior_message THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_MESSAGE_REGRESSION';
  END IF;

  IF next_message > prior_message AND (
    NEW."state" NOT IN ('active', 'renewing')
    OR NEW."provider_resource_id" IS NULL
    OR NEW."last_notification_at" IS NULL
    OR (
      OLD."last_notification_at" IS NOT NULL
      AND NEW."last_notification_at" < OLD."last_notification_at"
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_NOTIFICATION_INVALID';
  END IF;

  IF next_message = prior_message
    AND NEW."last_notification_at" IS DISTINCT FROM OLD."last_notification_at"
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_NOTIFICATION_MESSAGE_REQUIRED';
  END IF;

  IF OLD."last_reconciled_at" IS NOT NULL AND (
    NEW."last_reconciled_at" IS NULL
    OR NEW."last_reconciled_at" < OLD."last_reconciled_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_RECONCILIATION_REGRESSION';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "google_calendar_watches_protect"
  BEFORE INSERT OR UPDATE OR DELETE ON "google_calendar_watches"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_google_calendar_watch"();

-- If a renewal is promoted, its predecessor must be retired in the same
-- transaction. The deferred check permits either update order while keeping
-- the old active channel valid until commit.
CREATE FUNCTION "validate_google_calendar_watch_renewal"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."state" <> 'active' OR NEW."renewal_of_watch_id" IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM "google_calendar_watches" AS old_watch
  WHERE old_watch."id" = NEW."renewal_of_watch_id"
    AND old_watch."producer_id" = NEW."producer_id"
    AND old_watch."state" = 'retired'
    AND old_watch."ended_at" IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_WATCH_RENEWAL_NOT_ATOMIC';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "google_calendar_watches_renewal_check"
  AFTER INSERT OR UPDATE ON "google_calendar_watches"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "validate_google_calendar_watch_renewal"();

-- The existing outbox guard already freezes its operation, payload, link, and
-- revision. Freeze the new webhook trust references alongside that intent.
CREATE FUNCTION "protect_calendar_sync_job_reconcile_identity"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    NEW."google_calendar_watch_id", NEW."webhook_message_number"
  ) IS DISTINCT FROM ROW(
    OLD."google_calendar_watch_id", OLD."webhook_message_number"
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_RECONCILE_IDENTITY_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_jobs_reconcile_identity_protect"
  BEFORE UPDATE ON "calendar_sync_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_calendar_sync_job_reconcile_identity"();

-- Bind every reconciliation job to one already-known linked event. Webhook
-- jobs additionally prove the same producer, account version, destination,
-- accepted channel state, and exact message watermark. Recovery jobs retain
-- no watch or provider-notification identity.
CREATE OR REPLACE FUNCTION "validate_calendar_sync_job_link"()
RETURNS trigger AS $function$
DECLARE
  link_row record;
BEGIN
  IF NEW."booking_calendar_link_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    link."allowance_use_id",
    link."desired_revision",
    link."provider_state",
    link."connection_id",
    link."account_version",
    link."destination_calendar_id_fingerprint",
    booking."calendar_revision" AS booking_revision
  INTO link_row
  FROM "booking_calendar_links" AS link
  JOIN "bookings" AS booking
    ON booking."id" = NEW."booking_id"
   AND booking."producer_id" = NEW."producer_id"
   AND booking."allowance_use_id" = link."allowance_use_id"
  WHERE link."id" = NEW."booking_calendar_link_id"
    AND link."producer_id" = NEW."producer_id"
  FOR KEY SHARE OF link, booking;

  IF NOT FOUND
    OR link_row.booking_revision <> NEW."desired_revision"
    OR link_row."desired_revision" < NEW."desired_revision"
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_LINK_REVISION_INVALID';
  END IF;

  IF NEW."operation" <> 'reconcile_google_event' AND (
    NEW."google_calendar_watch_id" IS NOT NULL
    OR NEW."webhook_message_number" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_WATCH_SCOPE_INVALID';
  END IF;

  IF NEW."operation" = 'reconcile_google_event' THEN
    IF link_row."provider_state" <> 'active' THEN
      RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_RECONCILE_LINK_INACTIVE';
    END IF;

    IF NEW."google_calendar_watch_id" IS NULL THEN
      IF NEW."webhook_message_number" IS NOT NULL THEN
        RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_RECOVERY_SCOPE_INVALID';
      END IF;
    ELSE
      PERFORM 1
      FROM "google_calendar_watches" AS watch
      WHERE watch."id" = NEW."google_calendar_watch_id"
        AND watch."producer_id" = NEW."producer_id"
        AND watch."connection_id" = link_row."connection_id"
        AND watch."account_version" = link_row."account_version"
        AND watch."destination_calendar_id_fingerprint"
          = link_row."destination_calendar_id_fingerprint"
        AND watch."state" IN ('active', 'renewing')
        AND watch."provider_resource_id" IS NOT NULL
        AND watch."last_message_number" = NEW."webhook_message_number"
      FOR KEY SHARE OF watch;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_WATCH_SCOPE_INVALID';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Reconciliation completes after a bounded read and CAS decision; unlike an
-- outbound write it does not need to advance the last outbound revision or
-- prove an invitation result.
CREATE OR REPLACE FUNCTION "validate_calendar_sync_job_completion"()
RETURNS trigger AS $function$
DECLARE
  link_row "booking_calendar_links"%ROWTYPE;
BEGIN
  IF NEW."status" <> 'completed'
    OR NEW."booking_calendar_link_id" IS NULL
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO link_row
  FROM "booking_calendar_links"
  WHERE "id" = NEW."booking_calendar_link_id"
    AND "producer_id" = NEW."producer_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_COMPLETION_LINK_REQUIRED';
  END IF;

  IF NEW."operation" IN ('upsert_google_event', 'delete_google_event')
    AND link_row."desired_revision" > NEW."desired_revision"
  THEN
    RETURN NULL;
  END IF;

  IF NEW."operation" IN ('upsert_google_event', 'delete_google_event') AND (
    link_row."last_google_revision" < NEW."desired_revision"
    OR (
      link_row."last_google_revision" = NEW."desired_revision"
      AND (
        (NEW."operation" = 'upsert_google_event' AND link_row."provider_state" <> 'active')
        OR (NEW."operation" = 'delete_google_event' AND link_row."provider_state" <> 'deleted')
      )
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_GOOGLE_RESULT_REQUIRED';
  END IF;

  IF NEW."payload_snapshot"->>'notificationMode' = 'all' AND (
    link_row."invitation_revision" < NEW."desired_revision"
    OR link_row."invitation_delivered_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_INVITATION_DELIVERY_REQUIRED';
  END IF;

  IF NEW."delivery_channel" = 'ics' AND (
    link_row."invitation_revision" < NEW."desired_revision"
    OR link_row."invitation_channel" <> 'ics'
    OR link_row."invitation_delivered_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_ICS_FALLBACK_DELIVERY_REQUIRED';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

-- Preserve every SK-194 lineage/invitation guard while allowing a leased
-- known-link reconciliation to advance only remote ETag/updated and inbound
-- health facts. A stale reconcile may mark conflict, but cannot apply older
-- provider facts over a newer Skitza intent.
CREATE OR REPLACE FUNCTION "protect_booking_calendar_link"()
RETURNS trigger AS $function$
DECLARE
  current_booking_revision integer;
  current_booking_source uuid;
  current_booking_status text;
  current_booking_outcome text;
  is_ics_fallback_switch boolean := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_DELETE_FORBIDDEN';
  END IF;

  SELECT
    booking."calendar_revision",
    booking."rescheduled_from_booking_id",
    booking."status"::text,
    booking."outcome"::text
  INTO
    current_booking_revision,
    current_booking_source,
    current_booking_status,
    current_booking_outcome
  FROM "bookings" AS booking
  WHERE booking."id" = NEW."current_booking_id"
    AND booking."producer_id" = NEW."producer_id"
    AND booking."allowance_use_id" = NEW."allowance_use_id"
  FOR KEY SHARE OF booking;

  IF NOT FOUND OR (
    current_booking_revision <> NEW."desired_revision"
    AND NOT (
      TG_OP = 'UPDATE'
      AND current_booking_revision = NEW."desired_revision" + 1
      AND (
        (
          current_booking_status = 'completed'
          AND current_booking_outcome = 'completed'
        )
        OR (
          current_booking_status = 'no_show'
          AND current_booking_outcome = 'no_show'
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_CURRENT_REVISION_INVALID';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "google_calendar_connections" AS connection_row
    JOIN "google_calendar_selections" AS selection_row
      ON selection_row."connection_id" = connection_row."id"
     AND selection_row."producer_id" = connection_row."producer_id"
     AND selection_row."account_version" = connection_row."account_version"
    WHERE connection_row."id" = NEW."connection_id"
      AND connection_row."producer_id" = NEW."producer_id"
      AND connection_row."account_version" = NEW."account_version"
      AND connection_row."status" = 'connected'
      AND selection_row."id" = NEW."destination_selection_id"
      AND selection_row."is_destination" = true
      AND selection_row."provider_calendar_id_ciphertext"
        = NEW."destination_calendar_id_ciphertext"
      AND selection_row."provider_calendar_id_iv"
        = NEW."destination_calendar_id_iv"
      AND selection_row."provider_calendar_id_auth_tag"
        = NEW."destination_calendar_id_auth_tag"
      AND selection_row."provider_calendar_id_key_version"
        = NEW."destination_calendar_id_key_version"
      AND selection_row."provider_calendar_id_fingerprint"
        = NEW."destination_calendar_id_fingerprint"
    FOR KEY SHARE OF connection_row, selection_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_DESTINATION_INVALID';
    END IF;

    RETURN NEW;
  END IF;

  IF ROW(
    OLD."id", OLD."producer_id", OLD."allowance_use_id",
    OLD."origin_booking_id", OLD."connection_id", OLD."account_version",
    OLD."destination_selection_id",
    OLD."destination_calendar_id_ciphertext",
    OLD."destination_calendar_id_iv",
    OLD."destination_calendar_id_auth_tag",
    OLD."destination_calendar_id_key_version",
    OLD."destination_calendar_id_fingerprint",
    OLD."provider_event_id", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."allowance_use_id",
    NEW."origin_booking_id", NEW."connection_id", NEW."account_version",
    NEW."destination_selection_id",
    NEW."destination_calendar_id_ciphertext",
    NEW."destination_calendar_id_iv",
    NEW."destination_calendar_id_auth_tag",
    NEW."destination_calendar_id_key_version",
    NEW."destination_calendar_id_fingerprint",
    NEW."provider_event_id", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_UPDATED_AT_REQUIRED';
  END IF;

  IF NEW."desired_revision" < OLD."desired_revision" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_DESIRED_REVISION_REGRESSION';
  END IF;

  IF NEW."current_booking_id" IS DISTINCT FROM OLD."current_booking_id" AND (
    current_booking_source IS DISTINCT FROM OLD."current_booking_id"
    OR NEW."desired_revision" <= OLD."desired_revision"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_REPLACEMENT_INVALID';
  END IF;

  IF NEW."last_google_revision" < OLD."last_google_revision" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_GOOGLE_REVISION_REGRESSION';
  END IF;

  IF OLD."last_google_synced_at" IS NOT NULL AND (
    NEW."last_google_synced_at" IS NULL
    OR NEW."last_google_synced_at" < OLD."last_google_synced_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_GOOGLE_TIMESTAMP_REGRESSION';
  END IF;

  IF OLD."provider_event_updated_at" IS NOT NULL AND (
    NEW."provider_event_updated_at" IS NULL
    OR NEW."provider_event_updated_at" < OLD."provider_event_updated_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_PROVIDER_UPDATED_REGRESSION';
  END IF;

  IF OLD."last_inbound_reconciled_at" IS NOT NULL AND (
    NEW."last_inbound_reconciled_at" IS NULL
    OR NEW."last_inbound_reconciled_at" < OLD."last_inbound_reconciled_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_RECONCILIATION_REGRESSION';
  END IF;

  IF OLD."provider_state" = 'deleted' AND NEW."provider_state" <> 'deleted' THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_PROVIDER_STATE_FINAL';
  END IF;

  IF OLD."provider_state" = 'active' AND NEW."provider_state" = 'uncreated' THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_PROVIDER_STATE_REGRESSION';
  END IF;

  IF NEW."provider_state" IS DISTINCT FROM OLD."provider_state"
    AND NEW."last_google_revision" <= OLD."last_google_revision"
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_PROVIDER_REVISION_REQUIRED';
  END IF;

  -- Outbound facts may advance only under their exact processing lease.
  IF ROW(
    OLD."provider_state", OLD."last_google_revision", OLD."last_google_synced_at"
  ) IS DISTINCT FROM ROW(
    NEW."provider_state", NEW."last_google_revision", NEW."last_google_synced_at"
  ) THEN
    IF NEW."last_google_synced_at" IS NULL OR (
      OLD."last_google_synced_at" IS NOT NULL
      AND NEW."last_google_synced_at" <= OLD."last_google_synced_at"
    ) THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_GOOGLE_TIMESTAMP_REQUIRED';
    END IF;

    PERFORM 1
    FROM "calendar_sync_jobs" AS job
    WHERE job."booking_calendar_link_id" = NEW."id"
      AND job."producer_id" = NEW."producer_id"
      AND job."delivery_channel" = 'google'
      AND job."desired_revision" = NEW."last_google_revision"
      AND job."status" = 'processing'
      AND (
        (NEW."provider_state" = 'active' AND job."operation" = 'upsert_google_event')
        OR (NEW."provider_state" = 'deleted' AND job."operation" = 'delete_google_event')
      )
    FOR KEY SHARE OF job;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_GOOGLE_LEASE_REQUIRED';
    END IF;
  ELSIF ROW(
    OLD."provider_event_etag", OLD."provider_event_updated_at"
  ) IS DISTINCT FROM ROW(
    NEW."provider_event_etag", NEW."provider_event_updated_at"
  ) THEN
    -- A reconciliation can refresh remote facts only from the exact Skitza
    -- revision it prepared. Accepted inbound changes may advance NEW by one.
    PERFORM 1
    FROM "calendar_sync_jobs" AS job
    WHERE job."booking_calendar_link_id" = NEW."id"
      AND job."producer_id" = NEW."producer_id"
      AND job."operation" = 'reconcile_google_event'
      AND job."status" = 'processing'
      AND job."desired_revision" = OLD."desired_revision"
      AND NEW."desired_revision" IN (OLD."desired_revision", OLD."desired_revision" + 1)
    FOR KEY SHARE OF job;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_RECONCILE_LEASE_REQUIRED';
    END IF;
  END IF;

  IF NEW."last_inbound_reconciled_at" IS DISTINCT FROM OLD."last_inbound_reconciled_at" THEN
    PERFORM 1
    FROM "calendar_sync_jobs" AS job
    WHERE job."booking_calendar_link_id" = NEW."id"
      AND job."producer_id" = NEW."producer_id"
      AND job."operation" = 'reconcile_google_event'
      AND job."status" = 'processing'
      AND job."desired_revision" <= OLD."desired_revision"
    FOR KEY SHARE OF job;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_RECONCILE_LEASE_REQUIRED';
    END IF;
  END IF;

  IF ROW(NEW."sync_state", NEW."last_sync_error_code") IS DISTINCT FROM ROW(
    OLD."sync_state", OLD."last_sync_error_code"
  ) THEN
    IF NEW."sync_state_changed_at" <= OLD."sync_state_changed_at" THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_SYNC_STATE_TIMESTAMP_REQUIRED';
    END IF;
  ELSIF NEW."sync_state_changed_at" IS DISTINCT FROM OLD."sync_state_changed_at" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_SYNC_STATE_CHANGE_REQUIRED';
  END IF;

  IF NEW."invitation_revision" < OLD."invitation_revision" THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_REVISION_REGRESSION';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND OLD."invitation_attempted_at" IS NOT NULL
    AND (
      NEW."invitation_attempted_at" IS NULL
      OR NEW."invitation_attempted_at" < OLD."invitation_attempted_at"
    )
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_REGRESSION';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND OLD."invitation_delivered_at" IS NOT NULL
    AND NEW."invitation_attempted_at" IS DISTINCT FROM OLD."invitation_attempted_at"
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_FINAL';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND NEW."invitation_attempted_at" IS DISTINCT FROM OLD."invitation_attempted_at"
    AND NEW."invitation_channel" <> 'google'
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_CHANNEL_INVALID';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND OLD."invitation_channel" = 'google'
    AND NEW."invitation_channel" = 'ics'
    AND NEW."invitation_reserved_at" IS NOT DISTINCT FROM OLD."invitation_reserved_at"
    AND NEW."invitation_attempted_at" IS NOT DISTINCT FROM OLD."invitation_attempted_at"
    AND OLD."invitation_delivered_at" IS NULL
    AND NEW."invitation_delivered_at" IS NULL
  THEN
    PERFORM 1
    FROM "calendar_sync_jobs" AS fallback_job
    WHERE fallback_job."booking_calendar_link_id" = NEW."id"
      AND fallback_job."producer_id" = NEW."producer_id"
      AND fallback_job."delivery_channel" = 'ics'
      AND fallback_job."operation" = 'send_ics'
      AND fallback_job."desired_revision" = NEW."invitation_revision"
      AND fallback_job."status" IN ('pending', 'processing')
    FOR UPDATE OF fallback_job;

    is_ics_fallback_switch := FOUND;
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision" AND ROW(
    NEW."invitation_channel", NEW."invitation_reserved_at"
  ) IS DISTINCT FROM ROW(
    OLD."invitation_channel", OLD."invitation_reserved_at"
  ) AND NOT is_ics_fallback_switch THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_RESERVATION_IMMUTABLE';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND OLD."invitation_delivered_at" IS NOT NULL
    AND NEW."invitation_delivered_at" IS DISTINCT FROM OLD."invitation_delivered_at"
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_DELIVERY_IMMUTABLE';
  END IF;

  IF NEW."invitation_revision" > OLD."invitation_revision" AND (
    NEW."invitation_attempted_at" IS NOT NULL
    OR NEW."invitation_delivered_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_RESERVE_FIRST';
  END IF;

  IF NEW."invitation_revision" = OLD."invitation_revision"
    AND NEW."invitation_delivered_at" IS DISTINCT FROM OLD."invitation_delivered_at"
    AND NEW."invitation_delivered_at" IS NOT NULL
    AND NEW."invitation_channel" = 'google'
    AND NEW."invitation_attempted_at" IS NULL
  THEN
    RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_REQUIRED';
  END IF;

  IF ROW(
    OLD."invitation_revision", OLD."invitation_channel",
    OLD."invitation_reserved_at", OLD."invitation_attempted_at",
    OLD."invitation_delivered_at"
  ) IS DISTINCT FROM ROW(
    NEW."invitation_revision", NEW."invitation_channel",
    NEW."invitation_reserved_at", NEW."invitation_attempted_at",
    NEW."invitation_delivered_at"
  ) AND NOT is_ics_fallback_switch THEN
    PERFORM 1
    FROM "calendar_sync_jobs" AS job
    WHERE job."booking_calendar_link_id" = NEW."id"
      AND job."producer_id" = NEW."producer_id"
      AND job."delivery_channel" = NEW."invitation_channel"
      AND job."desired_revision" = NEW."invitation_revision"
      AND job."status" = 'processing'
      AND (
        (
          job."delivery_channel" = 'google'
          AND job."payload_snapshot"->>'notificationMode' = 'all'
        )
        OR (
          job."delivery_channel" = 'ics'
          AND job."operation" = 'send_ics'
        )
      )
    FOR KEY SHARE OF job;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKITZA_BOOKING_CALENDAR_LINK_INVITATION_LEASE_REQUIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;
