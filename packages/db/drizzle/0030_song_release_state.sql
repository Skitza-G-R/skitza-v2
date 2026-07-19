-- SK-8: keep a song's Released state separate from Done / Delivered.
-- Existing songs remain unreleased; this migration does not infer product state.

ALTER TABLE "project_tracks"
  ADD COLUMN "released_at" timestamp with time zone;

CREATE OR REPLACE FUNCTION "skitza_guard_song_release_state"()
RETURNS trigger AS $function$
BEGIN
  IF OLD."released_at" IS NOT NULL
    AND NEW."released_at" IS DISTINCT FROM OLD."released_at"
  THEN
    RAISE EXCEPTION 'SKITZA_SONG_RELEASE_STATE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "project_tracks_release_state_immutable"
BEFORE UPDATE OF "released_at" ON "project_tracks"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_song_release_state"();
