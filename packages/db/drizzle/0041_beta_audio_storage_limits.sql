-- SK-196: decimal 100MB upload cap, producer quota query indexes, and a
-- durable storage terminal markers that release quota only after exact R2
-- cleanup/sealing has been verified.

ALTER TABLE "track_versions"
  ADD COLUMN "audio_storage_deleted_at" timestamp with time zone;

ALTER TABLE "track_versions"
  ADD COLUMN "pending_audio_complete_write_once_protected_at" timestamp with time zone;

ALTER TABLE "track_versions"
  ADD CONSTRAINT "track_versions_pending_audio_complete_write_once_shape"
  CHECK (
    "pending_audio_complete_write_once_protected_at" IS NULL
    OR (
      "pending_audio_complete_attempted_at" IS NOT NULL
      AND "pending_audio_complete_write_once_protected_at" = "pending_audio_complete_attempted_at"
    )
  );

-- A first-Version browser capability is not released from producer quota
-- until its exact staging key has been replaced by the durable seal marker.
-- Existing rows may have an already-issued, overwrite-capable URL. Retain a
-- conservative expiry for audit, leave protection/revocation NULL, and keep
-- those rows fail-closed until the old signing credential is revoked.
-- Rollout order is mandatory: rotate/revoke the old R2 signing credential,
-- then an operator may mark exact legacy rows revoked and invoke the explicit
-- reconciliation mutation. Application code must never populate this gate.
ALTER TABLE "first_version_upload_intents"
  ADD COLUMN "latest_upload_url_expires_at" timestamp with time zone,
  ADD COLUMN "legacy_upload_capabilities_revoked_at" timestamp with time zone,
  ADD COLUMN "upload_url_write_once_protected_at" timestamp with time zone,
  ADD COLUMN "staging_sealed_at" timestamp with time zone;

UPDATE "first_version_upload_intents"
SET "latest_upload_url_expires_at" = transaction_timestamp() + interval '15 minutes';

ALTER TABLE "first_version_upload_intents"
  ADD CONSTRAINT "first_version_upload_intents_staging_seal_shape"
  CHECK (
    (
      "legacy_upload_capabilities_revoked_at" IS NULL
      OR "legacy_upload_capabilities_revoked_at" >= "created_at"
    )
    AND
    (
      "upload_url_write_once_protected_at" IS NULL
      OR (
        "latest_upload_url_expires_at" IS NOT NULL
        AND "upload_url_write_once_protected_at" >= "created_at"
        AND "upload_url_write_once_protected_at" <= "latest_upload_url_expires_at"
      )
    )
    AND (
      "staging_sealed_at" IS NULL
      OR (
        "staging_sealed_at" >= "created_at"
        AND (
          (
            "latest_upload_url_expires_at" IS NULL
            AND "upload_url_write_once_protected_at" IS NULL
          )
          OR (
            "latest_upload_url_expires_at" IS NOT NULL
            AND (
              (
                "upload_url_write_once_protected_at" IS NOT NULL
                AND "staging_sealed_at" >= "upload_url_write_once_protected_at"
              )
              OR (
                "legacy_upload_capabilities_revoked_at" IS NOT NULL
                AND "staging_sealed_at" >= "legacy_upload_capabilities_revoked_at"
              )
            )
          )
        )
      )
    )
  );

ALTER TABLE "track_versions"
  ADD CONSTRAINT "track_versions_audio_storage_deleted_shape"
  CHECK (
    "audio_storage_deleted_at" IS NULL
    OR (
      "audio_deleted_at" IS NOT NULL
      AND "audio_storage_deleted_at" >= "audio_deleted_at"
    )
  );

-- Enforce the beta cap only when a reservation size is first written or
-- changed. Existing oversized beta rows may still update cancellation or
-- completion state, and multipart cleanup may clear its size to NULL.
CREATE OR REPLACE FUNCTION "enforce_track_version_pending_audio_size_limit"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."pending_audio_size_bytes" IS NOT NULL
    AND NEW."pending_audio_size_bytes" > 100000000
  THEN
    RAISE EXCEPTION 'SKITZA_TRACK_VERSION_PENDING_AUDIO_SIZE_LIMIT';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "track_versions_pending_audio_size_limit"
  BEFORE INSERT OR UPDATE OF "pending_audio_size_bytes" ON "track_versions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_track_version_pending_audio_size_limit"();

-- Migration 0039's validated 500MiB content-shape CHECK remains in place for
-- legacy compatibility. This transition trigger is the authoritative 100MB
-- beta admission boundary for newly inserted or resized V1 intents.
CREATE OR REPLACE FUNCTION "enforce_first_version_upload_size_limit"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."audio_size_bytes" > 100000000 THEN
    RAISE EXCEPTION 'SKITZA_FIRST_VERSION_UPLOAD_SIZE_LIMIT';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "first_version_upload_intents_audio_size_limit"
  BEFORE INSERT OR UPDATE OF "audio_size_bytes" ON "first_version_upload_intents"
  FOR EACH ROW EXECUTE FUNCTION "enforce_first_version_upload_size_limit"();

CREATE INDEX "track_versions_producer_stored_audio_idx"
  ON "track_versions" ("producer_id")
  WHERE "size_bytes" IS NOT NULL AND "audio_storage_deleted_at" IS NULL;

CREATE INDEX "track_versions_producer_pending_audio_idx"
  ON "track_versions" ("producer_id")
  WHERE "pending_audio_size_bytes" IS NOT NULL;

CREATE INDEX "first_version_upload_intents_producer_unsealed_idx"
  ON "first_version_upload_intents" ("producer_id", "expires_at")
  WHERE "staging_sealed_at" IS NULL;
