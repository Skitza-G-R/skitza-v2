-- SK-163: keep file-first upload intent separate from durable Songs. A Song
-- and its V1 are inserted together only after the exact R2 object is verified.

CREATE TABLE "first_version_upload_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL,
  "purchase_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "track_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "title" text NOT NULL,
  "artist" text,
  "label" text NOT NULL,
  "description" text,
  "staging_audio_r2_key" text NOT NULL,
  "audio_r2_key" text NOT NULL,
  "audio_content_type" text NOT NULL,
  "audio_size_bytes" bigint NOT NULL,
  "duration_ms" integer,
  "completion_token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "canceled_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "first_version_upload_intents_operation_unique"
    UNIQUE ("producer_id", "operation_key"),
  CONSTRAINT "first_version_upload_intents_track_unique" UNIQUE ("track_id"),
  CONSTRAINT "first_version_upload_intents_version_unique" UNIQUE ("version_id"),
  CONSTRAINT "first_version_upload_intents_staging_audio_key_unique"
    UNIQUE ("staging_audio_r2_key"),
  CONSTRAINT "first_version_upload_intents_audio_key_unique" UNIQUE ("audio_r2_key"),
  CONSTRAINT "first_version_upload_intents_project_producer_fk"
    FOREIGN KEY ("project_id", "producer_id")
    REFERENCES "projects"("id", "producer_id") ON DELETE CASCADE,
  CONSTRAINT "first_version_upload_intents_purchase_project_fk"
    FOREIGN KEY ("purchase_id", "project_id")
    REFERENCES "purchases"("id", "project_id") ON DELETE CASCADE,
  CONSTRAINT "first_version_upload_intents_purchase_producer_fk"
    FOREIGN KEY ("purchase_id", "producer_id")
    REFERENCES "purchases"("id", "producer_id") ON DELETE CASCADE,
  CONSTRAINT "first_version_upload_intents_identity_shape"
    CHECK (
      "request_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "completion_token" ~ '^[0-9a-f]{64}$'
      AND NULLIF(btrim("staging_audio_r2_key"), '') IS NOT NULL
      AND char_length("staging_audio_r2_key") <= 1024
      AND NULLIF(btrim("audio_r2_key"), '') IS NOT NULL
      AND char_length("audio_r2_key") <= 1024
      AND "staging_audio_r2_key" <> "audio_r2_key"
    ),
  CONSTRAINT "first_version_upload_intents_content_shape"
    CHECK (
      "audio_size_bytes" > 0
      AND "audio_size_bytes" <= 524288000
      AND ("duration_ms" IS NULL OR "duration_ms" BETWEEN 1 AND 86400000)
      AND char_length("title") BETWEEN 1 AND 120
      AND char_length("label") BETWEEN 1 AND 40
      AND ("artist" IS NULL OR char_length("artist") BETWEEN 1 AND 120)
      AND ("description" IS NULL OR char_length("description") BETWEEN 1 AND 500)
    ),
  CONSTRAINT "first_version_upload_intents_state_shape"
    CHECK (
      NOT ("canceled_at" IS NOT NULL AND "completed_at" IS NOT NULL)
      AND "expires_at" > "created_at"
      AND "updated_at" >= "created_at"
    )
);

CREATE INDEX "first_version_upload_intents_producer_state_idx"
  ON "first_version_upload_intents" (
    "producer_id",
    "completed_at",
    "canceled_at",
    "expires_at"
  );
