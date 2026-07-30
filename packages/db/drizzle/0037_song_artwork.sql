-- SK-151: optional private cover artwork shared by every version of one song.
-- Existing songs retain the generated fallback because all identity fields are
-- nullable. The application exposes only an authenticated same-origin route.

ALTER TABLE "project_tracks"
  ADD COLUMN "artwork_r2_key" text,
  ADD COLUMN "artwork_content_type" text,
  ADD COLUMN "artwork_size_bytes" bigint,
  ADD COLUMN "artwork_object_etag" text,
  ADD CONSTRAINT "project_tracks_artwork_identity_shape"
    CHECK ((
        (
          "artwork_r2_key" IS NULL
          AND "artwork_content_type" IS NULL
          AND "artwork_size_bytes" IS NULL
          AND "artwork_object_etag" IS NULL
        )
        OR
        (
          NULLIF(btrim("artwork_r2_key"), '') IS NOT NULL
          AND char_length("artwork_r2_key") <= 1024
          AND "artwork_content_type" IN ('image/jpeg', 'image/png', 'image/webp')
          AND "artwork_size_bytes" > 0
          AND "artwork_size_bytes" <= 5242880
          AND NULLIF(btrim("artwork_object_etag"), '') IS NOT NULL
          AND char_length("artwork_object_etag") <= 512
        )
      ) IS TRUE);
