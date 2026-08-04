ALTER TABLE "artist_notifications"
  ADD COLUMN "archived_at" timestamp with time zone;

ALTER TABLE "artist_notifications"
  ADD CONSTRAINT "artist_notifications_archived_timestamp_shape"
  CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at");

DROP INDEX "artist_notifications_recipient_feed_idx";
DROP INDEX "artist_notifications_recipient_unread_idx";
DROP INDEX "artist_notifications_recipient_studio_dot_idx";

CREATE INDEX "artist_notifications_recipient_feed_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "in_app_visible",
    "archived_at",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "artist_notifications_recipient_unread_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "created_at" DESC,
    "id" DESC
  )
  WHERE "in_app_visible" IS TRUE
    AND "archived_at" IS NULL
    AND "read_at" IS NULL;

CREATE INDEX "artist_notifications_recipient_studio_dot_idx"
  ON "artist_notifications" (
    "recipient_clerk_user_id",
    "producer_id",
    "created_at" DESC,
    "id" DESC
  )
  WHERE "switcher_dot_worthy" IS TRUE
    AND "archived_at" IS NULL
    AND "opened_at" IS NULL;
