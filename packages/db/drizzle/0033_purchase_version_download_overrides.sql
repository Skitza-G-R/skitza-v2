-- SK-40: make exact purchase-version early-download overrides ordered and
-- intent-idempotent without rewriting or discarding append-only history.
--
-- The migration runner executes this file transactionally. Holding the table
-- locks across the deterministic legacy backfill mean no writer can observe
-- the short interval in which the append-only trigger is replaced. Acquire
-- them in runtime delivery order so an in-flight authorization cannot deadlock
-- against the migration while it moves from stored audio to override history.

-- Fail immediately instead of waiting while holding a partial table-lock set.
-- The operator must drain app traffic and retry the whole transactional file.
LOCK TABLE "track_versions" IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE "portfolio_tracks" IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE "purchase_download_override_events" IN ACCESS EXCLUSIVE MODE NOWAIT;

DROP TRIGGER "purchase_download_overrides_append_only"
  ON "purchase_download_override_events";

ALTER TABLE "purchase_download_override_events"
  ADD COLUMN "sequence" integer;

WITH "ranked_override_events" AS (
  SELECT
    "id",
    CAST(
      row_number() OVER (
        PARTITION BY "purchase_id", "version_id"
        ORDER BY "created_at", "id"
      ) AS integer
    ) AS "sequence"
  FROM "purchase_download_override_events"
)
UPDATE "purchase_download_override_events" AS event
SET "sequence" = ranked."sequence"
FROM "ranked_override_events" AS ranked
WHERE event."id" = ranked."id";

-- Materialize stable legacy command identities from each immutable event id,
-- then convert them to ordinary required columns without a second UPDATE.
ALTER TABLE "purchase_download_override_events"
  ADD COLUMN "operation_key" text GENERATED ALWAYS AS (
    'legacy:purchase-download-override:' || "id"::text
  ) STORED,
  ADD COLUMN "operation_digest" text GENERATED ALWAYS AS (
    'legacy:purchase-download-override-digest:' || "id"::text
  ) STORED;

ALTER TABLE "purchase_download_override_events"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "operation_key" DROP EXPRESSION,
  ALTER COLUMN "operation_digest" DROP EXPRESSION,
  ALTER COLUMN "operation_key" SET NOT NULL,
  ALTER COLUMN "operation_digest" SET NOT NULL,
  ADD CONSTRAINT "purchase_download_overrides_purchase_version_sequence_unique"
    UNIQUE ("purchase_id", "version_id", "sequence"),
  ADD CONSTRAINT "purchase_download_overrides_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  ADD CONSTRAINT "purchase_download_overrides_positive_sequence"
    CHECK ("sequence" > 0),
  ADD CONSTRAINT "purchase_download_overrides_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "purchase_download_overrides_actor_shape"
    CHECK (NULLIF(btrim("changed_by_clerk_user_id"), '') IS NOT NULL);

DROP INDEX "purchase_download_overrides_version_created_idx";

CREATE INDEX "purchase_download_overrides_version_sequence_idx"
  ON "purchase_download_override_events" ("purchase_id", "version_id", "sequence");

CREATE TRIGGER "purchase_download_overrides_append_only"
  BEFORE UPDATE OR DELETE ON "purchase_download_override_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Replace every completed Skitza-owned permanent audio URL with an app route.
-- The immutable object key/ETag/fingerprint remain server-only authorization
-- inputs; the URL stored in read models is now safe to hand to a browser.
ALTER TABLE "track_versions" DISABLE TRIGGER "track_versions_protect_identity";

UPDATE "track_versions"
SET "audio_url" = '/api/audio/stream/' || "id"::text
WHERE "audio_url" IS NOT NULL
  AND "audio_r2_key" IS NOT NULL
  AND "audio_url" IS DISTINCT FROM '/api/audio/stream/' || "id"::text;

ALTER TABLE "track_versions" ENABLE TRIGGER "track_versions_protect_identity";

UPDATE "portfolio_tracks" AS portfolio
SET "audio_url" = '/api/audio/public/portfolio/' || portfolio."id"::text
WHERE portfolio."audio_r2_key" IS NOT NULL;

ALTER TABLE "track_versions"
  ADD CONSTRAINT "track_versions_protected_audio_url"
    CHECK (
      "audio_url" IS NULL
      OR "audio_url" = '/api/audio/stream/' || "id"::text
    );

ALTER TABLE "portfolio_tracks"
  ADD CONSTRAINT "portfolio_tracks_protected_owned_audio_url"
    CHECK (
      "audio_r2_key" IS NULL
      OR "audio_url" = '/api/audio/public/portfolio/' || "id"::text
    );
