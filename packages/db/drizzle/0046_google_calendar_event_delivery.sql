-- SK-194 extends the existing calendar outbox with durable Google event
-- delivery. Existing ICS rows keep their original defaults and retry model.

ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_payload_shape";

ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_attempt_shape";

-- Rebuild the enum transactionally. PostgreSQL does not allow a value added
-- with ALTER TYPE ... ADD VALUE to be used until its transaction commits, but
-- one migration file is intentionally one atomic transaction.
ALTER TYPE "calendar_sync_job_operation"
  RENAME TO "calendar_sync_job_operation_legacy";

CREATE TYPE "calendar_sync_job_operation" AS ENUM (
  'send_ics',
  'upsert_google_event',
  'delete_google_event'
);

ALTER TABLE "calendar_sync_jobs"
  ALTER COLUMN "operation" TYPE "calendar_sync_job_operation"
  USING "operation"::text::"calendar_sync_job_operation";

DROP TYPE "calendar_sync_job_operation_legacy";

CREATE TYPE "calendar_sync_delivery_channel" AS ENUM ('ics', 'google');

CREATE TYPE "booking_calendar_link_provider_state" AS ENUM (
  'uncreated',
  'active',
  'deleted'
);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_id_producer_allowance_use_unique"
  UNIQUE ("id", "producer_id", "allowance_use_id");

-- One row owns one stable provider event for an allowance-use lineage and
-- Google account version. It intentionally has no FK to current selections:
-- disconnect and account switch delete selection rows, while historical event
-- identities must survive. destination_selection_id preserves the encryption
-- AAD needed to decrypt the copied destination envelope.
CREATE TABLE "booking_calendar_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "allowance_use_id" uuid NOT NULL,
  "origin_booking_id" uuid NOT NULL,
  "current_booking_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "account_version" integer NOT NULL,
  "destination_selection_id" uuid NOT NULL,
  "destination_calendar_id_ciphertext" text NOT NULL,
  "destination_calendar_id_iv" text NOT NULL,
  "destination_calendar_id_auth_tag" text NOT NULL,
  "destination_calendar_id_key_version" integer NOT NULL,
  "destination_calendar_id_fingerprint" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "provider_event_etag" text,
  "provider_state" "booking_calendar_link_provider_state" DEFAULT 'uncreated' NOT NULL,
  "desired_revision" integer NOT NULL,
  "last_google_revision" integer DEFAULT 0 NOT NULL,
  "last_google_synced_at" timestamp with time zone,
  "invitation_revision" integer DEFAULT 0 NOT NULL,
  "invitation_channel" "calendar_sync_delivery_channel",
  "invitation_reserved_at" timestamp with time zone,
  "invitation_attempted_at" timestamp with time zone,
  "invitation_delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_calendar_links_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "booking_calendar_links_lineage_account_unique"
    UNIQUE ("producer_id", "allowance_use_id", "connection_id", "account_version"),
  -- connection_id is stable across account switches, so this also prevents a
  -- new account version from reusing an old provider event identity.
  CONSTRAINT "booking_calendar_links_provider_event_unique"
    UNIQUE ("connection_id", "provider_event_id"),
  CONSTRAINT "booking_calendar_links_origin_booking_lineage_fk"
    FOREIGN KEY ("origin_booking_id", "producer_id", "allowance_use_id")
    REFERENCES "bookings" ("id", "producer_id", "allowance_use_id")
    ON DELETE RESTRICT,
  CONSTRAINT "booking_calendar_links_current_booking_lineage_fk"
    FOREIGN KEY ("current_booking_id", "producer_id", "allowance_use_id")
    REFERENCES "bookings" ("id", "producer_id", "allowance_use_id")
    ON DELETE RESTRICT,
  CONSTRAINT "booking_calendar_links_connection_producer_fk"
    FOREIGN KEY ("connection_id", "producer_id")
    REFERENCES "google_calendar_connections" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "booking_calendar_links_encrypted_destination_shape" CHECK ((
    "destination_calendar_id_ciphertext" ~ '^[A-Za-z0-9_-]+$'
    AND char_length("destination_calendar_id_ciphertext") <= 8192
    AND "destination_calendar_id_iv" ~ '^[A-Za-z0-9_-]{16}$'
    AND "destination_calendar_id_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'
    AND "destination_calendar_id_key_version" > 0
    AND "destination_calendar_id_fingerprint" ~ '^hmac-sha256:[0-9a-f]{64}$'
  ) IS TRUE),
  CONSTRAINT "booking_calendar_links_identity_shape" CHECK ((
    "account_version" > 0
    AND "provider_event_id" ~ '^[0-9a-v]+$'
    AND char_length("provider_event_id") BETWEEN 5 AND 1024
    AND "desired_revision" > 0
  ) IS TRUE),
  CONSTRAINT "booking_calendar_links_provider_state_shape" CHECK ((
    (
      "provider_state" = 'uncreated'
      AND "provider_event_etag" IS NULL
      AND "last_google_revision" = 0
      AND "last_google_synced_at" IS NULL
    )
    OR (
      "provider_state" = 'active'
      AND NULLIF(btrim("provider_event_etag"), '') IS NOT NULL
      AND char_length("provider_event_etag") <= 2048
      AND "last_google_revision" > 0
      AND "last_google_synced_at" IS NOT NULL
    )
    OR (
      "provider_state" = 'deleted'
      AND "provider_event_etag" IS NULL
      AND "last_google_revision" > 0
      AND "last_google_synced_at" IS NOT NULL
    )
  ) IS TRUE),
  CONSTRAINT "booking_calendar_links_revision_shape" CHECK ((
    "last_google_revision" >= 0
    AND "invitation_revision" >= 0
    AND "desired_revision" >= "last_google_revision"
    AND "desired_revision" >= "invitation_revision"
  ) IS TRUE),
  CONSTRAINT "booking_calendar_links_invitation_shape" CHECK ((
    (
      "invitation_revision" = 0
      AND "invitation_channel" IS NULL
      AND "invitation_reserved_at" IS NULL
      AND "invitation_attempted_at" IS NULL
      AND "invitation_delivered_at" IS NULL
    )
    OR (
      "invitation_revision" > 0
      AND "invitation_channel" IS NOT NULL
      AND "invitation_reserved_at" IS NOT NULL
      AND (
        "invitation_attempted_at" IS NULL
        OR "invitation_attempted_at" >= "invitation_reserved_at"
      )
      AND (
        "invitation_delivered_at" IS NULL
        OR (
          "invitation_delivered_at" >= "invitation_reserved_at"
          AND (
            "invitation_attempted_at" IS NULL
            OR "invitation_delivered_at" >= "invitation_attempted_at"
          )
          AND (
            "invitation_channel" <> 'google'
            OR "invitation_attempted_at" IS NOT NULL
          )
        )
      )
    )
  ) IS TRUE),
  CONSTRAINT "booking_calendar_links_timestamp_shape" CHECK ((
    "updated_at" >= "created_at"
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
  ) IS TRUE)
);

CREATE INDEX "booking_calendar_links_current_booking_idx"
  ON "booking_calendar_links" ("producer_id", "current_booking_id", "id");

CREATE INDEX "booking_calendar_links_reconciliation_idx"
  ON "booking_calendar_links" (
    "connection_id",
    "account_version",
    "provider_state",
    "desired_revision",
    "last_google_revision",
    "id"
  );

ALTER TABLE "calendar_sync_jobs"
  ADD COLUMN "delivery_channel" "calendar_sync_delivery_channel" DEFAULT 'ics' NOT NULL,
  ADD COLUMN "booking_calendar_link_id" uuid;

-- The historical global booking/operation/revision key cannot distinguish a
-- new Google account version. ICS remains booking-scoped, while Google jobs
-- are deduped by their account-version-specific link below.
ALTER TABLE "calendar_sync_jobs"
  DROP CONSTRAINT "calendar_sync_jobs_booking_operation_revision_unique";

CREATE UNIQUE INDEX "calendar_sync_jobs_ics_booking_operation_revision_unique"
  ON "calendar_sync_jobs" ("booking_id", "operation", "desired_revision")
  WHERE "delivery_channel" = 'ics';

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_booking_calendar_link_producer_fk"
  FOREIGN KEY ("booking_calendar_link_id", "producer_id")
  REFERENCES "booking_calendar_links" ("id", "producer_id")
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX "calendar_sync_jobs_link_channel_revision_unique"
  ON "calendar_sync_jobs" (
    "booking_calendar_link_id",
    "delivery_channel",
    "desired_revision"
  )
  WHERE "booking_calendar_link_id" IS NOT NULL;

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_channel_shape" CHECK ((
    (
      "operation" = 'send_ics'
      AND "delivery_channel" = 'ics'
    )
    OR (
      "operation" IN ('upsert_google_event', 'delete_google_event')
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
      )
      OR (
        "operation" IN ('upsert_google_event', 'delete_google_event')
        AND "payload_snapshot"->>'schemaVersion' = '2'
        AND ("payload_snapshot"->>'sequence') ~ '^[0-9]+$'
        AND ("payload_snapshot"->>'sequence')::integer = "desired_revision"
        AND jsonb_typeof("payload_snapshot"->'privateProperties') = 'object'
        AND (
          ("payload_snapshot"->'privateProperties')
          - ARRAY['skitzaLink', 'skitzaRevision', 'skitzaSchema']::text[]
        ) = '{}'::jsonb
        AND "payload_snapshot"->'privateProperties'->>'skitzaLink'
          = "booking_calendar_link_id"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaRevision'
          = "desired_revision"::text
        AND "payload_snapshot"->'privateProperties'->>'skitzaSchema' = '1'
        AND (
          (
            "operation" = 'upsert_google_event'
            AND "payload_snapshot"->>'action' = 'upsert'
            AND (
              "payload_snapshot" - ARRAY[
                'schemaVersion',
                'action',
                'eventKind',
                'notificationMode',
                'sequence',
                'startsAtUtc',
                'endsAtUtc',
                'summary',
                'artistSafeUrl',
                'attendee',
                'privateProperties'
              ]::text[]
            ) = '{}'::jsonb
            AND "payload_snapshot"->>'eventKind' IN ('opaque_hold', 'confirmed')
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
            AND NULLIF(btrim("payload_snapshot"->>'startsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'startsAtUtc') <= 64
            AND NULLIF(btrim("payload_snapshot"->>'endsAtUtc'), '') IS NOT NULL
            AND right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'
            AND char_length("payload_snapshot"->>'endsAtUtc') <= 64
            AND "payload_snapshot"->>'endsAtUtc'
              <> "payload_snapshot"->>'startsAtUtc'
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
                AND (
                  ("payload_snapshot"->'attendee') - ARRAY['name', 'email']::text[]
                ) = '{}'::jsonb
                AND NULLIF(
                  btrim("payload_snapshot"->'attendee'->>'name'),
                  ''
                ) IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'name') <= 320
                AND NULLIF(
                  btrim("payload_snapshot"->'attendee'->>'email'),
                  ''
                ) IS NOT NULL
                AND char_length("payload_snapshot"->'attendee'->>'email') <= 320
              )
            )
          )
          OR (
            "operation" = 'delete_google_event'
            AND "payload_snapshot"->>'action' = 'delete'
            AND (
              "payload_snapshot" - ARRAY[
                'schemaVersion',
                'action',
                'notificationMode',
                'sequence',
                'privateProperties'
              ]::text[]
            ) = '{}'::jsonb
            AND "payload_snapshot"->>'notificationMode' IN ('none', 'all')
          )
        )
      )
    )
  ) IS TRUE);

ALTER TABLE "calendar_sync_jobs"
  ADD CONSTRAINT "calendar_sync_jobs_attempt_shape" CHECK ((
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
      AND (
        (
          "delivery_channel" = 'ics'
          AND "provider_dedupe_expires_at" > "first_attempt_at"
        )
        OR (
          "delivery_channel" = 'google'
          AND "provider_dedupe_expires_at" IS NULL
        )
      )
    )
  ) IS TRUE);

-- Google retries use a stable provider event ID and have no 24-hour Resend
-- dedupe deadline. The nullable audit field preserves true terminal Google
-- cycles without weakening existing ICS audits.
ALTER TABLE "calendar_sync_job_manual_retries"
  DROP CONSTRAINT "calendar_sync_job_manual_retries_prior_attempt_shape";

ALTER TABLE "calendar_sync_job_manual_retries"
  ALTER COLUMN "prior_provider_dedupe_expires_at" DROP NOT NULL;

ALTER TABLE "calendar_sync_job_manual_retries"
  ADD CONSTRAINT "calendar_sync_job_manual_retries_prior_attempt_shape" CHECK ((
    "prior_attempt_count" > 0
    AND "prior_last_attempt_at" >= "prior_first_attempt_at"
    AND (
      "prior_provider_dedupe_expires_at" IS NULL
      OR "prior_provider_dedupe_expires_at" > "prior_first_attempt_at"
    )
  ) IS TRUE);

CREATE FUNCTION "protect_booking_calendar_link"()
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
    -- Lock the connected account and destination candidate long enough to copy
    -- an exact, decryptable destination snapshot. The link itself deliberately
    -- does not retain a selection FK.
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

  IF ROW(
    OLD."provider_event_etag", OLD."provider_state",
    OLD."last_google_revision", OLD."last_google_synced_at"
  ) IS DISTINCT FROM ROW(
    NEW."provider_event_etag", NEW."provider_state",
    NEW."last_google_revision", NEW."last_google_synced_at"
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
  )
  THEN
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

CREATE TRIGGER "booking_calendar_links_protect"
  BEFORE INSERT OR UPDATE OR DELETE ON "booking_calendar_links"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_booking_calendar_link"();

CREATE FUNCTION "validate_calendar_sync_job_link"()
RETURNS trigger AS $function$
DECLARE
  link_desired_revision integer;
  booking_revision integer;
BEGIN
  IF NEW."booking_calendar_link_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT link."desired_revision", booking."calendar_revision"
  INTO link_desired_revision, booking_revision
  FROM "booking_calendar_links" AS link
  JOIN "bookings" AS booking
    ON booking."id" = NEW."booking_id"
   AND booking."producer_id" = NEW."producer_id"
   AND booking."allowance_use_id" = link."allowance_use_id"
  WHERE link."id" = NEW."booking_calendar_link_id"
    AND link."producer_id" = NEW."producer_id"
  FOR KEY SHARE OF link, booking;

  IF NOT FOUND
    OR booking_revision <> NEW."desired_revision"
    OR link_desired_revision < NEW."desired_revision"
  THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_LINK_REVISION_INVALID';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_sync_jobs_validate_link"
  BEFORE INSERT ON "calendar_sync_jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "validate_calendar_sync_job_link"();

CREATE FUNCTION "validate_calendar_sync_job_completion"()
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

  -- A newer calendar intent already superseded this job. Completing the old
  -- durable job must not require the link to move backwards to its revision.
  IF NEW."delivery_channel" = 'google'
    AND link_row."desired_revision" > NEW."desired_revision"
  THEN
    RETURN NULL;
  END IF;

  IF NEW."delivery_channel" = 'google' AND (
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

CREATE CONSTRAINT TRIGGER "calendar_sync_jobs_completion_link_check"
  AFTER INSERT OR UPDATE ON "calendar_sync_jobs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "validate_calendar_sync_job_completion"();

-- Preserve the SK-191 lifecycle guard while freezing the new channel/link
-- intent and allowing a nullable Google dedupe expiry in its audit proof.
CREATE OR REPLACE FUNCTION "protect_calendar_sync_job"()
RETURNS trigger AS $function$
DECLARE
  is_manual_retry boolean := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_CALENDAR_SYNC_JOB_DELETE_FORBIDDEN';
  END IF;

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
      AND retry."prior_provider_dedupe_expires_at"
        IS NOT DISTINCT FROM OLD."provider_dedupe_expires_at"
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
    OLD."id", OLD."booking_id", OLD."producer_id",
    OLD."delivery_channel", OLD."booking_calendar_link_id", OLD."operation",
    OLD."desired_revision", OLD."payload_snapshot", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."booking_id", NEW."producer_id",
    NEW."delivery_channel", NEW."booking_calendar_link_id", NEW."operation",
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
