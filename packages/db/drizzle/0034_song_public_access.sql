-- SK-98: make producer-controlled public song access revocable, ordered, and
-- auditable while keeping public playback derived from canonical live audio.
--
-- The custom migration runner executes this file in one transaction. NOWAIT
-- prevents a deploy from waiting while holding only part of this lock set.

LOCK TABLE "project_tracks" IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE "track_versions" IN ACCESS EXCLUSIVE MODE NOWAIT;
LOCK TABLE "song_public_links" IN ACCESS EXCLUSIVE MODE NOWAIT;

ALTER TABLE "track_versions"
  ADD CONSTRAINT "track_versions_id_track_purchase_producer_unique"
    UNIQUE ("id", "track_id", "purchase_id", "producer_id");

CREATE INDEX "track_versions_track_live_uploaded_idx"
  ON "track_versions" ("track_id", "uploaded_at" DESC, "id" DESC)
  WHERE "audio_deleted_at" IS NULL AND "audio_url" IS NOT NULL;

CREATE INDEX "project_tracks_project_portfolio_published_idx"
  ON "project_tracks" ("project_id", "portfolio_published_at" DESC, "id")
  WHERE "portfolio_published_at" IS NOT NULL;

ALTER TABLE "song_public_links"
  ADD CONSTRAINT "song_public_links_exact_scope_unique"
    UNIQUE ("id", "track_id", "purchase_id", "producer_id"),
  ADD CONSTRAINT "song_public_links_positive_token_version"
    CHECK ("token_version" > 0),
  ADD CONSTRAINT "song_public_links_token_hash_shape"
    CHECK ("token_hash" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "song_public_links_timestamp_shape"
    CHECK (
      "updated_at" >= "enabled_at"
      AND (
        "disabled_at" IS NULL
        OR ("disabled_at" >= "enabled_at" AND "updated_at" >= "disabled_at")
      )
    );

CREATE TABLE "song_public_access_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "track_id" uuid NOT NULL,
  "purchase_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "link_id" uuid,
  "version_id" uuid,
  "action" text NOT NULL,
  "sequence" integer NOT NULL,
  "token_version" integer,
  "token_hash" text,
  "changed" boolean DEFAULT false NOT NULL,
  "link_enabled" boolean NOT NULL,
  "portfolio_published" boolean NOT NULL,
  "remaining_audio_count" integer NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "changed_by_clerk_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "song_public_access_events_track_sequence_unique"
    UNIQUE ("track_id", "sequence"),
  CONSTRAINT "song_public_access_events_track_operation_unique"
    UNIQUE ("track_id", "operation_key"),
  CONSTRAINT "song_public_access_events_track_purchase_fk"
    FOREIGN KEY ("track_id", "purchase_id")
    REFERENCES "project_tracks" ("id", "purchase_id") ON DELETE RESTRICT,
  CONSTRAINT "song_public_access_events_purchase_producer_fk"
    FOREIGN KEY ("purchase_id", "producer_id")
    REFERENCES "purchases" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "song_public_access_events_link_scope_fk"
    FOREIGN KEY ("link_id", "track_id", "purchase_id", "producer_id")
    REFERENCES "song_public_links" ("id", "track_id", "purchase_id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "song_public_access_events_version_scope_fk"
    FOREIGN KEY ("version_id", "track_id", "purchase_id", "producer_id")
    REFERENCES "track_versions" ("id", "track_id", "purchase_id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "song_public_access_events_action_shape"
    CHECK (
      "action" IN (
        'link_published',
        'link_reset',
        'link_disabled',
        'audio_deleted',
        'portfolio_published',
        'portfolio_unpublished'
      )
    ),
  CONSTRAINT "song_public_access_events_positive_sequence"
    CHECK ("sequence" > 0),
  CONSTRAINT "song_public_access_events_token_snapshot_shape"
    CHECK (
      ("token_version" IS NULL AND "token_hash" IS NULL)
      OR (
        "token_version" > 0
        AND "token_hash" ~ '^sha256:[0-9a-f]{64}$'
      )
    ),
  CONSTRAINT "song_public_access_events_link_snapshot_shape"
    CHECK (
      (
        "link_id" IS NULL
        AND "token_version" IS NULL
        AND "token_hash" IS NULL
        AND "link_enabled" = false
      )
      OR (
        "link_id" IS NOT NULL
        AND "token_version" IS NOT NULL
        AND "token_hash" IS NOT NULL
      )
    ),
  CONSTRAINT "song_public_access_events_target_shape"
    CHECK (
      (
        "action" IN ('link_published', 'link_reset', 'link_disabled')
        AND "link_id" IS NOT NULL
        AND "version_id" IS NULL
      )
      OR ("action" = 'audio_deleted' AND "version_id" IS NOT NULL)
      OR (
        "action" IN ('portfolio_published', 'portfolio_unpublished')
        AND "version_id" IS NULL
      )
    ),
  CONSTRAINT "song_public_access_events_remaining_audio_nonnegative"
    CHECK ("remaining_audio_count" >= 0),
  CONSTRAINT "song_public_access_events_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  CONSTRAINT "song_public_access_events_actor_shape"
    CHECK (NULLIF(btrim("changed_by_clerk_user_id"), '') IS NOT NULL)
);

CREATE INDEX "song_public_access_events_track_sequence_idx"
  ON "song_public_access_events" ("track_id", "sequence");

CREATE TRIGGER "song_public_access_events_append_only"
  BEFORE UPDATE OR DELETE ON "song_public_access_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
