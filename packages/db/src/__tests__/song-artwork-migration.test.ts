import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { projectTracks } from "../schema";

const migration = readFileSync(join(process.cwd(), "drizzle/0037_song_artwork.sql"), "utf8");

describe("SK-151 song artwork schema", () => {
  it("keeps optional artwork on the song rather than an individual version", () => {
    expect(projectTracks.artworkR2Key.notNull).toBe(false);
    expect(projectTracks.artworkContentType.notNull).toBe(false);
    expect(projectTracks.artworkSizeBytes.notNull).toBe(false);
    expect(projectTracks.artworkObjectEtag.notNull).toBe(false);
    expect(getTableConfig(projectTracks).checks.map((constraint) => constraint.name)).toContain(
      "project_tracks_artwork_identity_shape",
    );
  });

  it("adds one all-null or exact private-object identity", () => {
    expect(migration).toMatch(/ALTER TABLE "project_tracks"/);
    for (const column of [
      "artwork_r2_key",
      "artwork_content_type",
      "artwork_size_bytes",
      "artwork_object_etag",
    ]) {
      expect(migration).toContain(`ADD COLUMN "${column}"`);
      expect(migration).toContain(`"${column}" IS NULL`);
    }
    expect(migration).toContain("project_tracks_artwork_identity_shape");
    expect(migration).toContain("image/jpeg");
    expect(migration).toContain("image/png");
    expect(migration).toContain("image/webp");
    expect(migration).toContain('"artwork_size_bytes" <= 5242880');
    expect(migration).toMatch(/\)\s+IS TRUE\s*\)\s*;/);
  });

  it("is additive and does not rewrite existing songs", () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
    expect(migration).not.toMatch(/ADD COLUMN "artwork_[a-z0-9_]+" (?:text|bigint) NOT NULL/i);
  });
});
