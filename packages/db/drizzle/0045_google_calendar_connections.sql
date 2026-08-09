-- SK-192: producer-only Google Calendar OAuth connection and CalendarList
-- selection metadata. This migration is additive only. FreeBusy enforcement,
-- event links/delivery, webhook state, backfill, and production exposure are
-- intentionally out of scope.

CREATE TYPE "google_calendar_connection_status" AS ENUM (
  'needs_selection',
  'connected',
  'reconnect_required',
  'disconnected'
);

CREATE TYPE "google_calendar_access_role" AS ENUM (
  'freeBusyReader',
  'reader',
  'writerWithoutPrivateAccess',
  'writer',
  'owner'
);

CREATE TYPE "google_calendar_oauth_intent" AS ENUM (
  'connect',
  'reconnect',
  'switch_account'
);

-- One durable connection row per producer. Secrets are AES-GCM envelopes
-- created server-side; access tokens, refresh tokens, and their encryption
-- material are never stored in plaintext. A disconnected row retains only
-- non-secret account/linkage metadata so same-account reconnect can dedupe.
CREATE TABLE "google_calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "google_subject" text NOT NULL,
  "google_account_email" text NOT NULL,
  "account_version" integer DEFAULT 1 NOT NULL,
  "status" "google_calendar_connection_status" DEFAULT 'needs_selection' NOT NULL,
  "granted_scopes" text[] NOT NULL,
  "access_token_ciphertext" text,
  "access_token_iv" text,
  "access_token_auth_tag" text,
  "access_token_key_version" integer,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_ciphertext" text,
  "refresh_token_iv" text,
  "refresh_token_auth_tag" text,
  "refresh_token_key_version" integer,
  "refresh_token_updated_at" timestamp with time zone,
  "last_authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reconnect_required_at" timestamp with time zone,
  "disconnected_at" timestamp with time zone,
  "last_successful_availability_sync_at" timestamp with time zone,
  "last_successful_event_sync_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_calendar_connections_producer_unique"
    UNIQUE ("producer_id"),
  CONSTRAINT "google_calendar_connections_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "google_calendar_connections_id_producer_account_unique"
    UNIQUE ("id", "producer_id", "account_version"),
  CONSTRAINT "google_calendar_connections_producer_fk"
    FOREIGN KEY ("producer_id")
    REFERENCES "producers" ("id") ON DELETE CASCADE,
  CONSTRAINT "google_calendar_connections_identity_shape" CHECK ((
    NULLIF(btrim("google_subject"), '') IS NOT NULL
    AND char_length("google_subject") <= 255
    AND "google_account_email" = lower(btrim("google_account_email"))
    AND "google_account_email" ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    AND char_length("google_account_email") <= 320
    AND "account_version" > 0
    AND cardinality("granted_scopes") > 0
    AND array_position("granted_scopes", NULL) IS NULL
  ) IS TRUE),
  CONSTRAINT "google_calendar_connections_token_shape" CHECK ((
    (
      (
        "access_token_ciphertext" IS NULL
        AND "access_token_iv" IS NULL
        AND "access_token_auth_tag" IS NULL
        AND "access_token_key_version" IS NULL
        AND "access_token_expires_at" IS NULL
      )
      OR (
        "access_token_ciphertext" ~ '^[A-Za-z0-9_-]+$'
        AND char_length("access_token_ciphertext") <= 8192
        AND "access_token_iv" ~ '^[A-Za-z0-9_-]{16}$'
        AND "access_token_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'
        AND "access_token_key_version" > 0
        AND "access_token_expires_at" > "created_at"
      )
    )
    AND (
      (
        "refresh_token_ciphertext" IS NULL
        AND "refresh_token_iv" IS NULL
        AND "refresh_token_auth_tag" IS NULL
        AND "refresh_token_key_version" IS NULL
        AND "refresh_token_updated_at" IS NULL
      )
      OR (
        "refresh_token_ciphertext" ~ '^[A-Za-z0-9_-]+$'
        AND char_length("refresh_token_ciphertext") <= 8192
        AND "refresh_token_iv" ~ '^[A-Za-z0-9_-]{16}$'
        AND "refresh_token_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'
        AND "refresh_token_key_version" > 0
        AND "refresh_token_updated_at" >= "created_at"
      )
    )
    AND (
      "status" NOT IN ('needs_selection', 'connected')
      OR (
        "access_token_ciphertext" IS NOT NULL
        AND "refresh_token_ciphertext" IS NOT NULL
      )
    )
    AND (
      "status" <> 'disconnected'
      OR (
        "access_token_ciphertext" IS NULL
        AND "refresh_token_ciphertext" IS NULL
      )
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_connections_state_shape" CHECK ((
    (
      "status" = 'reconnect_required'
      AND "reconnect_required_at" IS NOT NULL
      AND "disconnected_at" IS NULL
    )
    OR (
      "status" = 'disconnected'
      AND "reconnect_required_at" IS NULL
      AND "disconnected_at" IS NOT NULL
    )
    OR (
      "status" IN ('needs_selection', 'connected')
      AND "reconnect_required_at" IS NULL
      AND "disconnected_at" IS NULL
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_connections_timestamp_shape" CHECK ((
    "last_authorized_at" >= "created_at"
    AND "updated_at" >= "created_at"
    AND (
      "reconnect_required_at" IS NULL
      OR "reconnect_required_at" >= "created_at"
    )
    AND (
      "disconnected_at" IS NULL
      OR "disconnected_at" >= "created_at"
    )
    AND (
      "last_successful_availability_sync_at" IS NULL
      OR "last_successful_availability_sync_at" >= "created_at"
    )
    AND (
      "last_successful_event_sync_at" IS NULL
      OR "last_successful_event_sync_at" >= "created_at"
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_connections_safe_error_shape" CHECK (
    "last_error_code" IS NULL
    OR "last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$'
  )
);

-- Store every visible CalendarList candidate so the selection UI never needs
-- to persist a raw provider ID. Fingerprints support equality/dedupe; the
-- encrypted ID is opened only at the server-only provider boundary.
CREATE TABLE "google_calendar_selections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "account_version" integer NOT NULL,
  "provider_calendar_id_ciphertext" text NOT NULL,
  "provider_calendar_id_iv" text NOT NULL,
  "provider_calendar_id_auth_tag" text NOT NULL,
  "provider_calendar_id_key_version" integer NOT NULL,
  "provider_calendar_id_fingerprint" text NOT NULL,
  "display_name" text NOT NULL,
  "timezone" text,
  "access_role" "google_calendar_access_role" NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "is_destination" boolean DEFAULT false NOT NULL,
  "blocks_availability" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_calendar_selections_calendar_fingerprint_unique"
    UNIQUE (
      "connection_id",
      "account_version",
      "provider_calendar_id_fingerprint"
    ),
  CONSTRAINT "google_calendar_selections_connection_producer_account_fk"
    FOREIGN KEY ("connection_id", "producer_id", "account_version")
    REFERENCES "google_calendar_connections" (
      "id",
      "producer_id",
      "account_version"
    ) ON DELETE CASCADE,
  CONSTRAINT "google_calendar_selections_encrypted_id_shape" CHECK ((
    "provider_calendar_id_ciphertext" ~ '^[A-Za-z0-9_-]+$'
    AND char_length("provider_calendar_id_ciphertext") <= 8192
    AND "provider_calendar_id_iv" ~ '^[A-Za-z0-9_-]{16}$'
    AND "provider_calendar_id_auth_tag" ~ '^[A-Za-z0-9_-]{22}$'
    AND "provider_calendar_id_key_version" > 0
    AND "provider_calendar_id_fingerprint" ~ '^hmac-sha256:[0-9a-f]{64}$'
  ) IS TRUE),
  CONSTRAINT "google_calendar_selections_metadata_shape" CHECK ((
    "account_version" > 0
    AND NULLIF(btrim("display_name"), '') IS NOT NULL
    AND char_length("display_name") <= 1024
    AND (
      "timezone" IS NULL
      OR (
        NULLIF(btrim("timezone"), '') IS NOT NULL
        AND char_length("timezone") <= 255
      )
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_selections_destination_access_shape" CHECK (
    "is_destination" = false
    OR "access_role" IN ('writer', 'owner')
  ),
  CONSTRAINT "google_calendar_selections_timestamp_shape"
    CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "google_calendar_selections_one_destination"
  ON "google_calendar_selections" ("connection_id", "account_version")
  WHERE "is_destination" = true;

CREATE UNIQUE INDEX "google_calendar_selections_one_primary"
  ON "google_calendar_selections" ("connection_id", "account_version")
  WHERE "is_primary" = true;

CREATE INDEX "google_calendar_selections_producer_busy_idx"
  ON "google_calendar_selections" (
    "producer_id",
    "connection_id",
    "account_version",
    "id"
  )
  WHERE "blocks_availability" = true;

-- The raw signed state token, authorization code, and PKCE verifier never
-- enter the database. The digest is claimed atomically by the callback, while
-- the expected account version rejects stale concurrent reconnects/switches.
CREATE TABLE "google_calendar_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state_token_digest" text NOT NULL,
  "producer_id" uuid NOT NULL,
  "intent" "google_calendar_oauth_intent" NOT NULL,
  "connection_id" uuid,
  "expected_account_version" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_calendar_oauth_states_state_digest_unique"
    UNIQUE ("state_token_digest"),
  CONSTRAINT "google_calendar_oauth_states_producer_fk"
    FOREIGN KEY ("producer_id")
    REFERENCES "producers" ("id") ON DELETE CASCADE,
  CONSTRAINT "google_calendar_oauth_states_connection_producer_fk"
    FOREIGN KEY ("connection_id", "producer_id")
    REFERENCES "google_calendar_connections" ("id", "producer_id")
    ON DELETE CASCADE,
  CONSTRAINT "google_calendar_oauth_states_digest_shape" CHECK (
    "state_token_digest" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "google_calendar_oauth_states_intent_shape" CHECK ((
    (
      "intent" = 'connect'
      AND "connection_id" IS NULL
      AND "expected_account_version" IS NULL
    )
    OR (
      "intent" IN ('reconnect', 'switch_account')
      AND "connection_id" IS NOT NULL
      AND "expected_account_version" > 0
    )
  ) IS TRUE),
  CONSTRAINT "google_calendar_oauth_states_lifetime_shape" CHECK ((
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + interval '15 minutes'
    AND (
      "consumed_at" IS NULL
      OR (
        "consumed_at" >= "created_at"
        AND "consumed_at" <= "expires_at"
      )
    )
  ) IS TRUE)
);

CREATE INDEX "google_calendar_oauth_states_expires_idx"
  ON "google_calendar_oauth_states" ("expires_at", "id");

-- Producer/connection identity is immutable. Only a pre-confirmed account
-- switch may replace the Google subject, and it must advance exactly one
-- account version. The composite CalendarList FK makes that update fail until
-- the service clears every prior-account candidate in the same transaction.
CREATE FUNCTION "protect_google_calendar_connection"()
RETURNS trigger AS $function$
BEGIN
  IF ROW(OLD."id", OLD."producer_id", OLD."created_at")
    IS DISTINCT FROM ROW(NEW."id", NEW."producer_id", NEW."created_at")
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_CONNECTION_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW."google_subject" IS NOT DISTINCT FROM OLD."google_subject" THEN
    IF NEW."account_version" <> OLD."account_version" THEN
      RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_ACCOUNT_VERSION_INVALID';
    END IF;
  ELSIF NEW."account_version" <> OLD."account_version" + 1
    OR NEW."status" NOT IN ('needs_selection', 'reconnect_required')
    OR NEW."last_authorized_at" <= OLD."last_authorized_at"
    OR ROW(
      NEW."access_token_ciphertext",
      NEW."access_token_iv",
      NEW."access_token_auth_tag",
      NEW."access_token_key_version"
    ) IS NOT DISTINCT FROM ROW(
      OLD."access_token_ciphertext",
      OLD."access_token_iv",
      OLD."access_token_auth_tag",
      OLD."access_token_key_version"
    )
    OR (
      (
        NEW."refresh_token_ciphertext" IS NOT NULL
        OR OLD."refresh_token_ciphertext" IS NOT NULL
      )
      AND ROW(
        NEW."refresh_token_ciphertext",
        NEW."refresh_token_iv",
        NEW."refresh_token_auth_tag",
        NEW."refresh_token_key_version"
      ) IS NOT DISTINCT FROM ROW(
        OLD."refresh_token_ciphertext",
        OLD."refresh_token_iv",
        OLD."refresh_token_auth_tag",
        OLD."refresh_token_key_version"
      )
    )
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_ACCOUNT_SWITCH_INVALID';
  END IF;

  IF (
    NEW."google_account_email" IS DISTINCT FROM OLD."google_account_email"
    OR NEW."granted_scopes" IS DISTINCT FROM OLD."granted_scopes"
  ) AND NEW."last_authorized_at" <= OLD."last_authorized_at"
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_AUTHORIZATION_TIMESTAMP_REQUIRED';
  END IF;

  IF NEW."last_authorized_at" < OLD."last_authorized_at" THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_AUTHORIZATION_TIMESTAMP_REGRESSION';
  END IF;

  IF ROW(
    NEW."refresh_token_ciphertext",
    NEW."refresh_token_iv",
    NEW."refresh_token_auth_tag",
    NEW."refresh_token_key_version"
  ) IS DISTINCT FROM ROW(
    OLD."refresh_token_ciphertext",
    OLD."refresh_token_iv",
    OLD."refresh_token_auth_tag",
    OLD."refresh_token_key_version"
  ) AND NEW."refresh_token_ciphertext" IS NOT NULL AND (
    NEW."refresh_token_updated_at" IS NULL
    OR (
      OLD."refresh_token_updated_at" IS NOT NULL
      AND NEW."refresh_token_updated_at" <= OLD."refresh_token_updated_at"
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_REFRESH_TOKEN_TIMESTAMP_REQUIRED';
  END IF;

  IF OLD."refresh_token_updated_at" IS NOT NULL
    AND NEW."refresh_token_updated_at" IS NOT NULL
    AND NEW."refresh_token_updated_at" < OLD."refresh_token_updated_at"
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_REFRESH_TOKEN_TIMESTAMP_REGRESSION';
  END IF;

  IF OLD."last_successful_availability_sync_at" IS NOT NULL AND (
    NEW."last_successful_availability_sync_at" IS NULL
    OR NEW."last_successful_availability_sync_at"
      < OLD."last_successful_availability_sync_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_AVAILABILITY_SYNC_REGRESSION';
  END IF;

  IF OLD."last_successful_event_sync_at" IS NOT NULL AND (
    NEW."last_successful_event_sync_at" IS NULL
    OR NEW."last_successful_event_sync_at" < OLD."last_successful_event_sync_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_EVENT_SYNC_REGRESSION';
  END IF;

  IF NEW IS DISTINCT FROM OLD AND NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_CONNECTION_UPDATED_AT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "google_calendar_connections_protect"
  BEFORE UPDATE ON "google_calendar_connections"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_google_calendar_connection"();

-- Candidate identity and tenant/account ownership cannot be rewritten. Normal
-- CalendarList refreshes may update display metadata, selection flags, and the
-- encrypted envelope during key rotation, but must advance updated_at.
CREATE FUNCTION "protect_google_calendar_selection"()
RETURNS trigger AS $function$
BEGIN
  IF ROW(
    OLD."id",
    OLD."connection_id",
    OLD."producer_id",
    OLD."account_version",
    OLD."provider_calendar_id_fingerprint",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."connection_id",
    NEW."producer_id",
    NEW."account_version",
    NEW."provider_calendar_id_fingerprint",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_SELECTION_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW IS DISTINCT FROM OLD AND NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_SELECTION_UPDATED_AT_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "google_calendar_selections_protect"
  BEFORE UPDATE ON "google_calendar_selections"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_google_calendar_selection"();

-- State rows are immutable except for one successful NULL -> consumed_at
-- transition. Expired rows may still be deleted by bounded cleanup work.
CREATE FUNCTION "consume_google_calendar_oauth_state_once"()
RETURNS trigger AS $function$
BEGIN
  IF ROW(
    OLD."id",
    OLD."state_token_digest",
    OLD."producer_id",
    OLD."intent",
    OLD."connection_id",
    OLD."expected_account_version",
    OLD."expires_at",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."state_token_digest",
    NEW."producer_id",
    NEW."intent",
    NEW."connection_id",
    NEW."expected_account_version",
    NEW."expires_at",
    NEW."created_at"
  ) OR OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL
  THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_OAUTH_STATE_IMMUTABLE_OR_CONSUMED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "google_calendar_oauth_states_consume_once"
  BEFORE UPDATE ON "google_calendar_oauth_states"
  FOR EACH ROW
  EXECUTE FUNCTION "consume_google_calendar_oauth_state_once"();

-- A connected status is committed only with one writable destination and at
-- least one busy calendar. Deferral lets the service replace the full visible
-- candidate list and set the connection state atomically in either order.
CREATE FUNCTION "enforce_google_calendar_connected_selection"()
RETURNS trigger AS $function$
DECLARE
  target_connection_id uuid;
  target_account_version integer;
  target_status "google_calendar_connection_status";
  destination_count integer;
  busy_count integer;
BEGIN
  IF TG_TABLE_NAME = 'google_calendar_connections' THEN
    target_connection_id := NEW."id";
  ELSE
    target_connection_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."connection_id"
      ELSE NEW."connection_id"
    END;
  END IF;

  SELECT "status", "account_version"
  INTO target_status, target_account_version
  FROM "google_calendar_connections"
  WHERE "id" = target_connection_id;

  IF NOT FOUND OR target_status <> 'connected' THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE "is_destination" = true),
    count(*) FILTER (WHERE "blocks_availability" = true)
  INTO destination_count, busy_count
  FROM "google_calendar_selections"
  WHERE "connection_id" = target_connection_id
    AND "account_version" = target_account_version;

  IF destination_count <> 1 OR busy_count < 1 THEN
    RAISE EXCEPTION 'SKITZA_GOOGLE_CALENDAR_CONNECTED_SELECTION_REQUIRED';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "google_calendar_connections_selection_ready"
  AFTER INSERT OR UPDATE ON "google_calendar_connections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_google_calendar_connected_selection"();

CREATE CONSTRAINT TRIGGER "google_calendar_selections_connection_ready"
  AFTER INSERT OR UPDATE OR DELETE ON "google_calendar_selections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_google_calendar_connected_selection"();
