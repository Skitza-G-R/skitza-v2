-- SK-197: begin the shared audio transfer before destination metadata is
-- complete. The historical first_version_upload_intents relation remains the
-- single storage/quota/cleanup authority, but now binds either a new Song or
-- a new Version only during finalization.

-- Fail fast instead of waiting behind live upload writers. The migration
-- runner applies this file in one transaction, so no caller can observe the
-- nullable pre-bind shape before the legacy backfill and completion guard are
-- both durable.
LOCK TABLE "first_version_upload_intents" IN ACCESS EXCLUSIVE MODE NOWAIT;

ALTER TABLE "first_version_upload_intents"
  ADD COLUMN "finalization_digest" text,
  ADD COLUMN "creates_track" boolean;

-- Rolling-deploy compatibility: a pre-SK-197 server still writes the fully
-- bound legacy shape and does not know the two columns above. Upgrade only
-- that unambiguous shape. Generic file-only staging keeps destination fields
-- null, so it deliberately bypasses this trigger.
CREATE FUNCTION "public"."upgrade_legacy_first_version_upload_intent"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."project_id" IS NOT NULL
    AND NEW."purchase_id" IS NOT NULL
    AND NEW."title" IS NOT NULL
    AND NEW."label" IS NOT NULL
    AND NEW."creates_track" IS NULL
    AND NEW."finalization_digest" IS NULL
  THEN
    NEW."creates_track" := true;
    NEW."finalization_digest" := NEW."request_digest";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "first_version_upload_intents_legacy_binding_compat"
  BEFORE INSERT OR UPDATE ON "first_version_upload_intents"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."upgrade_legacy_first_version_upload_intent"();

-- Every pre-SK-197 intent was prepared specifically for a new Song and its
-- first Version. Preserve retry compatibility for active, canceled, and
-- completed legacy operations without changing their file-stage identity.
UPDATE "first_version_upload_intents"
SET
  "creates_track" = true,
  "finalization_digest" = "request_digest";

ALTER TABLE "first_version_upload_intents"
  ALTER COLUMN "project_id" DROP NOT NULL,
  ALTER COLUMN "purchase_id" DROP NOT NULL,
  ALTER COLUMN "title" DROP NOT NULL,
  ALTER COLUMN "label" DROP NOT NULL,
  DROP CONSTRAINT "first_version_upload_intents_track_unique",
  ADD CONSTRAINT "first_version_upload_intents_finalization_shape"
    CHECK (
      (
        (
          "finalization_digest" IS NULL
          AND "creates_track" IS NULL
          AND "project_id" IS NULL
          AND "purchase_id" IS NULL
          AND "title" IS NULL
          AND "label" IS NULL
        )
        OR (
          "finalization_digest" ~ '^sha256:[0-9a-f]{64}$'
          AND "creates_track" IS NOT NULL
          AND "project_id" IS NOT NULL
          AND "purchase_id" IS NOT NULL
          AND "title" IS NOT NULL
          AND "label" IS NOT NULL
        )
      )
      AND ("completed_at" IS NULL OR "finalization_digest" IS NOT NULL)
    );

-- One staged file still owns one immutable Version id. Track ids are only
-- provisional for new-Song intents, though, and may be rebound to an existing
-- Song when creates_track is false. Keep deletion/reconciliation lookups fast
-- without making that provisional id permanently unique.
CREATE INDEX "first_version_upload_intents_track_idx"
  ON "first_version_upload_intents" ("track_id");
