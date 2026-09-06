-- SK-305: one lyrics sheet per song, editable by the producer and the artist.
--
-- Lyrics belong to the SONG (project_tracks), not to a version. A producer
-- thinks "the words of this song", not "the words of V2", and one sheet means
-- fixing a typo fixes it everywhere instead of leaving V1 and V2 stale behind
-- it. The artist also never sees two different sets of words depending on
-- which version they happened to open.
--
-- lyrics_updated_at is load-bearing, not cosmetic. Gili's call is that BOTH
-- sides write, so every save is a compare-and-set against the value the editor
-- loaded. A mismatch means somebody saved first, and the second save is
-- refused instead of silently replacing the whole sheet.
--
-- lyrics_updated_by stores the ROLE, not a user id: a producer row lives in
-- `producers` and an artist row in `client_contacts`, so no single foreign key
-- covers both, and each side's page already knows the other's display name.
--
-- Additive only. Every existing song keeps all three columns NULL, which the
-- shape constraint below accepts.

ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics" text;
ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics_updated_at" timestamp with time zone;
ALTER TABLE "project_tracks" ADD COLUMN IF NOT EXISTS "lyrics_updated_by" text;

-- Both stamps travel together, and lyrics can never exist unstamped —
-- otherwise the compare-and-set above would have nothing to compare against.
-- Clearing the sheet sets lyrics back to NULL but KEEPS the stamps, so "who
-- emptied this, and when" survives. The length cap is repeated here on purpose:
-- the application enforces 8000 characters, and a bug that bypassed the
-- application should not be able to park a novel on the song page.
ALTER TABLE "project_tracks" DROP CONSTRAINT IF EXISTS "project_tracks_lyrics_stamp_shape";
ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_lyrics_stamp_shape" CHECK (
  (
    (
      ("lyrics_updated_at" IS NULL AND "lyrics_updated_by" IS NULL)
      OR ("lyrics_updated_at" IS NOT NULL AND "lyrics_updated_by" IS NOT NULL)
    )
    AND ("lyrics" IS NULL OR "lyrics_updated_at" IS NOT NULL)
    AND ("lyrics" IS NULL OR char_length("lyrics") <= 8000)
  ) IS TRUE
);

-- Exactly the two roles the application writes. A third writer appearing here
-- would mean a caller invented one, which should fail loudly rather than
-- render as a blank name on somebody's song page.
ALTER TABLE "project_tracks" DROP CONSTRAINT IF EXISTS "project_tracks_lyrics_updated_by_allowed";
ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_lyrics_updated_by_allowed" CHECK (
  "lyrics_updated_by" IS NULL OR "lyrics_updated_by" IN ('producer', 'artist')
);
