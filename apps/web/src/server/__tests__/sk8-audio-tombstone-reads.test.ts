import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("SK-8 audio tombstone read boundary", () => {
  it("redacts deleted playback fields and falls back to available audio on both song detail routes", () => {
    const producer = source("trpc/routers/producer.ts");
    const artist = source("trpc/routers/artist.ts");
    const producerDetail = producer.slice(
      producer.indexOf("    detail: producerProcedure"),
      producer.indexOf("  // Full data export"),
    );
    const artistDetailStart = artist.indexOf("  detail: artistProcedure");
    const artistDetail = artist.slice(
      artistDetailStart,
      artist.indexOf("  // Resolve / re-open", artistDetailStart),
    );

    for (const detail of [producerDetail, artistDetail]) {
      expect(detail).toContain("audioDeletedAt: trackVersions.audioDeletedAt");
      expect(detail).toMatch(/audioUrl:\s*(?:version\.audioDeletedAt\s*\?\s*null|null)/);
      expect(detail).toMatch(/durationMs:\s*(?:version\.audioDeletedAt\s*\?\s*null|null)/);
      expect(detail).toMatch(/peaks:\s*(?:version\.audioDeletedAt\s*\?\s*null|null)/);
      expect(detail).toContain("versions.find((version) => version.audioUrl !== null)?.id");
      expect(detail).toMatch(
        /\.orderBy\(desc\(trackVersions\.uploadedAt\),\s*desc\(trackVersions\.id\)\)/,
      );
    }
  });

  it("keeps legacy list and search results limited to available audio while preserving redacted detail history", () => {
    const library = source("trpc/routers/library.ts");
    const list = library.slice(
      library.indexOf("  list: producerProcedure"),
      library.indexOf("  // Detail view"),
    );
    const detail = library.slice(
      library.indexOf("  detail: producerProcedure"),
      library.indexOf("  // ⌘K palette helper"),
    );
    const search = library.slice(library.indexOf("  search: producerProcedure"));

    for (const playbackSurface of [list, search]) {
      expect(playbackSurface).toContain("isNotNull(trackVersions.audioUrl)");
      expect(playbackSurface).toContain("isNull(trackVersions.audioDeletedAt)");
    }
    expect(detail).toContain("audioDeletedAt: trackVersions.audioDeletedAt");
    expect(detail).toContain("? { ...v, audioUrl: null, durationMs: null }");
  });
});
