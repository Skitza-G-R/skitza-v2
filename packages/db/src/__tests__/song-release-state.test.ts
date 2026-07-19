import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "src/schema.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "drizzle/0029_song_release_state.sql"), "utf8");

describe("SK-8 song release state", () => {
  it("stores release independently from creative workflow progress", () => {
    const tracksBlock = schema.slice(
      schema.indexOf("export const projectTracks ="),
      schema.indexOf("export type ProjectTrack ="),
    );

    expect(tracksBlock).toContain('workflowStage: workflowStage("workflow_stage")');
    expect(tracksBlock).toContain('releasedAt: timestamp("released_at"');
  });

  it("adds only the nullable per-song release timestamp", () => {
    expect(migration).toMatch(
      /ALTER TABLE "project_tracks"\s+ADD COLUMN "released_at" timestamp with time zone;/,
    );
    expect(migration).not.toMatch(/UPDATE\s+"project_tracks"/i);
    expect(migration).not.toMatch(/workflow_stage/i);
  });

  it("makes the first release timestamp permanent at the database boundary", () => {
    expect(migration).toContain('IF OLD."released_at" IS NOT NULL');
    expect(migration).toContain('AND NEW."released_at" IS DISTINCT FROM OLD."released_at"');
    expect(migration).toContain("SKITZA_SONG_RELEASE_STATE_IMMUTABLE");
    expect(migration).toMatch(
      /BEFORE UPDATE OF "released_at" ON "project_tracks"\s+FOR EACH ROW EXECUTE FUNCTION "skitza_guard_song_release_state"\(\);/,
    );
  });
});
