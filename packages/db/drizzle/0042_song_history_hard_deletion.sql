CREATE TABLE "song_deletion_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "kind" text NOT NULL,
  "project_id" uuid NOT NULL,
  "purchase_id" uuid NOT NULL,
  "track_id" uuid NOT NULL,
  "version_id" uuid,
  "target_version_ids" jsonb NOT NULL,
  "actor_clerk_user_id" text NOT NULL,
  "audio_manifest" jsonb NOT NULL,
  "artwork_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "first_version_staging_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "first_version_final_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "peaks_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "audio_bytes" bigint NOT NULL,
  "prepared_at" timestamptz DEFAULT now() NOT NULL,
  "storage_verified_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "song_deletion_operations_producer_operation_unique"
    UNIQUE ("producer_id", "operation_key"),
  CONSTRAINT "song_deletion_operations_producer_id_producers_id_fk"
    FOREIGN KEY ("producer_id") REFERENCES "producers"("id") ON DELETE CASCADE,
  CONSTRAINT "song_deletion_operations_identity_shape"
    CHECK (
      "request_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND char_length("operation_key") <= 200
      AND NULLIF(btrim("actor_clerk_user_id"), '') IS NOT NULL
      AND char_length("actor_clerk_user_id") <= 200
    ),
  CONSTRAINT "song_deletion_operations_target_shape"
    CHECK (
      CASE
        WHEN jsonb_typeof("target_version_ids") = 'array' THEN
          (
            (
              "kind" = 'version'
              AND "version_id" IS NOT NULL
              AND jsonb_array_length("target_version_ids") = 1
              AND "target_version_ids" ? "version_id"::text
            )
            OR ("kind" = 'song' AND "version_id" IS NULL)
          )
        ELSE false
      END
    ),
  CONSTRAINT "song_deletion_operations_manifest_shape"
    CHECK (
      jsonb_typeof("audio_manifest") = 'array'
      AND jsonb_typeof("artwork_manifest") = 'array'
      AND jsonb_typeof("first_version_staging_manifest") = 'array'
      AND jsonb_typeof("first_version_final_manifest") = 'array'
      AND jsonb_typeof("peaks_manifest") = 'array'
      AND "audio_bytes" >= 0
    ),
  CONSTRAINT "song_deletion_operations_timestamp_shape"
    CHECK (
      ("storage_verified_at" IS NULL OR "storage_verified_at" >= "prepared_at")
      AND (
        "completed_at" IS NULL
        OR ("storage_verified_at" IS NOT NULL AND "completed_at" >= "storage_verified_at")
      )
    )
);

CREATE INDEX "song_deletion_operations_producer_state_idx"
  ON "song_deletion_operations" ("producer_id", "completed_at", "prepared_at");

CREATE INDEX "song_deletion_operations_producer_track_idx"
  ON "song_deletion_operations" ("producer_id", "track_id", "prepared_at");

-- The operation is an immutable recovery receipt. Only the two state markers
-- may move forward, and completion requires a previously committed storage
-- verification. A receipt may not be removed with the history it authorizes.
CREATE OR REPLACE FUNCTION "protect_song_deletion_operation"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."storage_verified_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_INITIAL_STATE';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_DELETE_FORBIDDEN';
  END IF;

  IF ROW(
    OLD."id", OLD."producer_id", OLD."operation_key", OLD."request_digest",
    OLD."kind", OLD."project_id", OLD."purchase_id", OLD."track_id",
    OLD."version_id", OLD."target_version_ids", OLD."actor_clerk_user_id",
    OLD."audio_manifest", OLD."artwork_manifest", OLD."first_version_staging_manifest",
    OLD."first_version_final_manifest", OLD."peaks_manifest",
    OLD."audio_bytes", OLD."prepared_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."producer_id", NEW."operation_key", NEW."request_digest",
    NEW."kind", NEW."project_id", NEW."purchase_id", NEW."track_id",
    NEW."version_id", NEW."target_version_ids", NEW."actor_clerk_user_id",
    NEW."audio_manifest", NEW."artwork_manifest", NEW."first_version_staging_manifest",
    NEW."first_version_final_manifest", NEW."peaks_manifest",
    NEW."audio_bytes", NEW."prepared_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD."storage_verified_at" IS NOT NULL
    AND NEW."storage_verified_at" IS DISTINCT FROM OLD."storage_verified_at"
  THEN
    RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_STORAGE_STATE_IMMUTABLE';
  END IF;

  IF OLD."completed_at" IS NOT NULL
    AND NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
  THEN
    RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_COMPLETION_IMMUTABLE';
  END IF;

  IF OLD."completed_at" IS NULL
    AND NEW."completed_at" IS NOT NULL
    AND OLD."storage_verified_at" IS NULL
  THEN
    RAISE EXCEPTION 'SKITZA_SONG_DELETION_OPERATION_STORAGE_VERIFICATION_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "song_deletion_operations_protect_state"
  BEFORE INSERT OR UPDATE OR DELETE ON "song_deletion_operations"
  FOR EACH ROW EXECUTE FUNCTION "protect_song_deletion_operation"();

-- A delete authorization is the exact operation id kept in a transaction-
-- local setting. Every caller supplies the complete relational scope, and a
-- Version-scoped row must also be present in the operation's frozen target
-- set. The receipt must be storage-verified and not yet completed.
CREATE OR REPLACE FUNCTION "song_deletion_operation_allows"(
  expected_producer_id uuid,
  expected_project_id uuid,
  expected_purchase_id uuid,
  expected_track_id uuid,
  expected_version_id uuid,
  require_song boolean
)
RETURNS boolean AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM "song_deletion_operations" AS operation
    WHERE operation."id"::text =
      current_setting('skitza.song_deletion_operation_id', true)
      AND operation."producer_id" = expected_producer_id
      AND operation."project_id" = expected_project_id
      AND operation."purchase_id" = expected_purchase_id
      AND operation."track_id" = expected_track_id
      AND operation."storage_verified_at" IS NOT NULL
      AND operation."completed_at" IS NULL
      AND (NOT require_song OR operation."kind" = 'song')
      AND (
        expected_version_id IS NULL
        OR operation."target_version_ids" ? expected_version_id::text
      )
  );
$function$ LANGUAGE sql STABLE;

-- Download overrides and approvals share a producer/purchase/Version scope.
CREATE OR REPLACE FUNCTION "protect_deletable_version_history"()
RETURNS trigger AS $function$
DECLARE
  deletion_project_id uuid;
  deletion_track_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT track."project_id", version."track_id"
    INTO deletion_project_id, deletion_track_id
    FROM "track_versions" AS version
    INNER JOIN "project_tracks" AS track
      ON track."id" = version."track_id"
      AND track."purchase_id" = version."purchase_id"
    WHERE version."id" = OLD."version_id"
      AND version."purchase_id" = OLD."purchase_id"
      AND version."producer_id" = OLD."producer_id";

    IF "song_deletion_operation_allows"(
      OLD."producer_id",
      deletion_project_id,
      OLD."purchase_id",
      deletion_track_id,
      OLD."version_id",
      false
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'SKITZA_APPEND_ONLY_HISTORY_IMMUTABLE';
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "purchase_download_overrides_append_only"
  ON "purchase_download_override_events";
CREATE TRIGGER "purchase_download_overrides_append_only"
  BEFORE UPDATE OR DELETE ON "purchase_download_override_events"
  FOR EACH ROW EXECUTE FUNCTION "protect_deletable_version_history"();

DROP TRIGGER IF EXISTS "version_approval_events_append_only"
  ON "version_approval_events";
CREATE TRIGGER "version_approval_events_append_only"
  BEFORE UPDATE OR DELETE ON "version_approval_events"
  FOR EACH ROW EXECUTE FUNCTION "protect_deletable_version_history"();

CREATE OR REPLACE FUNCTION "protect_deletable_song_public_history"()
RETURNS trigger AS $function$
DECLARE
  deletion_project_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT track."project_id"
    INTO deletion_project_id
    FROM "project_tracks" AS track
    WHERE track."id" = OLD."track_id"
      AND track."purchase_id" = OLD."purchase_id";

    IF "song_deletion_operation_allows"(
      OLD."producer_id",
      deletion_project_id,
      OLD."purchase_id",
      OLD."track_id",
      OLD."version_id",
      OLD."version_id" IS NULL
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'SKITZA_APPEND_ONLY_HISTORY_IMMUTABLE';
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "song_public_access_events_append_only"
  ON "song_public_access_events";
CREATE TRIGGER "song_public_access_events_append_only"
  BEFORE UPDATE OR DELETE ON "song_public_access_events"
  FOR EACH ROW EXECUTE FUNCTION "protect_deletable_song_public_history"();

CREATE OR REPLACE FUNCTION "protect_deletable_artist_historical_access"()
RETURNS trigger AS $function$
DECLARE
  deletion_project_id uuid;
  deletion_purchase_id uuid;
  deletion_track_id uuid;
  deletion_version_id uuid;
  deletion_requires_song boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."resource_type" IN ('track_version', 'track_version_download') THEN
      SELECT track."project_id", version."purchase_id", version."track_id", version."id"
      INTO
        deletion_project_id,
        deletion_purchase_id,
        deletion_track_id,
        deletion_version_id
      FROM "track_versions" AS version
      INNER JOIN "project_tracks" AS track
        ON track."id" = version."track_id"
        AND track."purchase_id" = version."purchase_id"
      WHERE version."id" = OLD."resource_id"
        AND version."producer_id" = OLD."producer_id";
    ELSIF OLD."resource_type" = 'track_comment' THEN
      SELECT track."project_id", version."purchase_id", version."track_id", version."id"
      INTO
        deletion_project_id,
        deletion_purchase_id,
        deletion_track_id,
        deletion_version_id
      FROM "track_comments" AS comment
      INNER JOIN "track_versions" AS version
        ON version."id" = comment."version_id"
        AND version."producer_id" = comment."producer_id"
      INNER JOIN "project_tracks" AS track
        ON track."id" = version."track_id"
        AND track."purchase_id" = version."purchase_id"
      WHERE comment."id" = OLD."resource_id"
        AND comment."producer_id" = OLD."producer_id";
    ELSIF OLD."resource_type" = 'track' THEN
      SELECT track."project_id", track."purchase_id", track."id"
      INTO deletion_project_id, deletion_purchase_id, deletion_track_id
      FROM "project_tracks" AS track
      INNER JOIN "projects" AS project ON project."id" = track."project_id"
      WHERE track."id" = OLD."resource_id"
        AND project."producer_id" = OLD."producer_id";
      deletion_requires_song := true;
    END IF;

    IF "song_deletion_operation_allows"(
      OLD."producer_id",
      deletion_project_id,
      deletion_purchase_id,
      deletion_track_id,
      deletion_version_id,
      deletion_requires_song
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'SKITZA_APPEND_ONLY_HISTORY_IMMUTABLE';
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "artist_historical_access_grants_append_only"
  ON "artist_historical_access_grants";
CREATE TRIGGER "artist_historical_access_grants_append_only"
  BEFORE UPDATE OR DELETE ON "artist_historical_access_grants"
  FOR EACH ROW EXECUTE FUNCTION "protect_deletable_artist_historical_access"();

-- Serialize comment creation with deletion preparation. FOR SHARE waits for a
-- concurrent tombstone write to commit before inspecting the Version, while
-- the frozen operation target set covers any incomplete receipt.
CREATE OR REPLACE FUNCTION "reject_comment_for_deleting_track_version"()
RETURNS trigger AS $function$
DECLARE
  target_audio_deleted_at timestamptz;
BEGIN
  SELECT version."audio_deleted_at"
  INTO target_audio_deleted_at
  FROM "track_versions" AS version
  WHERE version."id" = NEW."version_id"
    AND version."producer_id" = NEW."producer_id"
  FOR SHARE;

  IF target_audio_deleted_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "song_deletion_operations" AS operation
      WHERE operation."producer_id" = NEW."producer_id"
        AND operation."completed_at" IS NULL
        AND operation."target_version_ids" ? NEW."version_id"::text
    )
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_COMMENT_TARGET_DELETING';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "track_comments_reject_deleting_version"
  BEFORE INSERT ON "track_comments"
  FOR EACH ROW EXECUTE FUNCTION "reject_comment_for_deleting_track_version"();

-- A pending deletion freezes public-link capabilities for the Song. The
-- prepare transaction may disable the link before inserting its receipt;
-- later publish/reset requests must wait for completion instead of reviving
-- a link whose last stored Version is disappearing.
CREATE OR REPLACE FUNCTION "reject_public_link_change_for_deleting_song"()
RETURNS trigger AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "song_deletion_operations" AS operation
    WHERE operation."producer_id" = NEW."producer_id"
      AND operation."purchase_id" = NEW."purchase_id"
      AND operation."track_id" = NEW."track_id"
      AND operation."completed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_SONG_PUBLIC_LINK_DELETION_IN_PROGRESS';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "song_public_links_reject_deleting_song"
  BEFORE INSERT OR UPDATE ON "song_public_links"
  FOR EACH ROW EXECUTE FUNCTION "reject_public_link_change_for_deleting_song"();

CREATE OR REPLACE FUNCTION "protect_project_track_identity"()
RETURNS trigger AS $function$
DECLARE
  deletion_producer_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT project."producer_id"
    INTO deletion_producer_id
    FROM "projects" AS project
    WHERE project."id" = OLD."project_id";

    IF "song_deletion_operation_allows"(
      deletion_producer_id,
      OLD."project_id",
      OLD."purchase_id",
      OLD."id",
      NULL,
      true
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SKITZA_PROJECT_TRACK_DELETE_FORBIDDEN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "song_deletion_operations" AS operation
    WHERE operation."track_id" = OLD."id"
      AND operation."project_id" = OLD."project_id"
      AND operation."purchase_id" = OLD."purchase_id"
      AND operation."completed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_PROJECT_TRACK_DELETION_IN_PROGRESS';
  END IF;

  IF ROW(OLD."id", OLD."project_id", OLD."purchase_id", OLD."created_at")
    IS DISTINCT FROM ROW(NEW."id", NEW."project_id", NEW."purchase_id", NEW."created_at")
  THEN
    RAISE EXCEPTION 'SKITZA_PROJECT_TRACK_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_track_version_identity"()
RETURNS trigger AS $function$
DECLARE
  deletion_project_id uuid;
  old_is_placeholder boolean;
  new_is_completed boolean;
  identity_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT track."project_id"
    INTO deletion_project_id
    FROM "project_tracks" AS track
    WHERE track."id" = OLD."track_id"
      AND track."purchase_id" = OLD."purchase_id";

    IF "song_deletion_operation_allows"(
      OLD."producer_id",
      deletion_project_id,
      OLD."purchase_id",
      OLD."track_id",
      OLD."id",
      false
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_DELETE_FORBIDDEN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "song_deletion_operations" AS operation
    WHERE operation."producer_id" = OLD."producer_id"
      AND operation."purchase_id" = OLD."purchase_id"
      AND operation."track_id" = OLD."track_id"
      AND operation."completed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_DELETION_IN_PROGRESS';
  END IF;

  IF ROW(OLD."id", OLD."track_id", OLD."purchase_id", OLD."producer_id", OLD."uploaded_at")
    IS DISTINCT FROM
    ROW(NEW."id", NEW."track_id", NEW."purchase_id", NEW."producer_id", NEW."uploaded_at")
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_IDENTITY_IMMUTABLE';
  END IF;

  old_is_placeholder := OLD."audio_url" IS NULL
    AND OLD."audio_r2_key" IS NULL
    AND OLD."size_bytes" IS NULL
    AND OLD."audio_object_etag" IS NULL
    AND OLD."audio_identity_fingerprint" IS NULL;
  new_is_completed := NEW."audio_url" IS NOT NULL
    AND NEW."audio_r2_key" IS NOT NULL
    AND NEW."size_bytes" IS NOT NULL
    AND NEW."audio_object_etag" IS NOT NULL
    AND NEW."audio_identity_fingerprint" IS NOT NULL;
  identity_changed := ROW(
    OLD."audio_url", OLD."audio_r2_key", OLD."size_bytes",
    OLD."audio_object_etag", OLD."audio_identity_fingerprint"
  ) IS DISTINCT FROM ROW(
    NEW."audio_url", NEW."audio_r2_key", NEW."size_bytes",
    NEW."audio_object_etag", NEW."audio_identity_fingerprint"
  );

  IF OLD."audio_deleted_at" IS NOT NULL
    AND NEW."audio_deleted_at" IS DISTINCT FROM OLD."audio_deleted_at"
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_DELETION_IMMUTABLE';
  END IF;

  IF OLD."audio_storage_deleted_at" IS NOT NULL
    AND NEW."audio_storage_deleted_at" IS DISTINCT FROM OLD."audio_storage_deleted_at"
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_STORAGE_DELETION_IMMUTABLE';
  END IF;

  IF NEW."audio_storage_deleted_at" IS NOT NULL
    AND NEW."audio_deleted_at" IS NULL
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_STORAGE_DELETION_REQUIRES_TOMBSTONE';
  END IF;

  IF identity_changed THEN
    IF NOT old_is_placeholder THEN
      RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_IDENTITY_IMMUTABLE';
    END IF;
    IF OLD."audio_deleted_at" IS NOT NULL
      OR NEW."audio_deleted_at" IS NOT NULL
      OR NOT new_is_completed
    THEN
      RAISE EXCEPTION 'SKITZA_TRACK_VERSION_AUDIO_IDENTITY_TRANSITION_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- No new sibling Version may enter a Song while an exact Version or the
-- entire Song is being removed. Existing rows are frozen by the identity
-- trigger above; this closes the INSERT side of the same public-state race.
CREATE OR REPLACE FUNCTION "reject_track_version_insert_for_deleting_song"()
RETURNS trigger AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "song_deletion_operations" AS operation
    WHERE operation."producer_id" = NEW."producer_id"
      AND operation."purchase_id" = NEW."purchase_id"
      AND operation."track_id" = NEW."track_id"
      AND operation."completed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_DELETION_IN_PROGRESS';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "track_versions_reject_deleting_song_insert"
  BEFORE INSERT ON "track_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_track_version_insert_for_deleting_song"();
