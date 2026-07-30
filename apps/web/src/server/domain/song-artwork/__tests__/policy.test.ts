import { describe, expect, it } from "vitest";

import {
  assertSongArtworkObjectEtag,
  assertSongArtworkUploadMetadata,
  MAX_SONG_ARTWORK_BYTES,
  normalizeSongArtworkFileName,
} from "../policy";

describe("song artwork upload policy", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "accepts supported browser artwork type %s",
    (contentType) => {
      expect(() => {
        assertSongArtworkUploadMetadata({ contentType, sizeBytes: 1024 });
      }).not.toThrow();
    },
  );

  it.each(["image/svg+xml", "application/pdf", "image/heic", "text/html"])(
    "rejects unsupported or active-content type %s",
    (contentType) => {
      expect(() => {
        assertSongArtworkUploadMetadata({ contentType, sizeBytes: 1024 });
      }).toThrow("Choose a JPG, PNG, or WebP image");
    },
  );

  it("enforces a positive five-megabyte maximum", () => {
    expect(() => {
      assertSongArtworkUploadMetadata({
        contentType: "image/png",
        sizeBytes: MAX_SONG_ARTWORK_BYTES,
      });
    }).not.toThrow();
    for (const sizeBytes of [0, -1, MAX_SONG_ARTWORK_BYTES + 1, 1.5]) {
      expect(() => {
        assertSongArtworkUploadMetadata({
          contentType: "image/png",
          sizeBytes,
        });
      }).toThrow("Artwork must be between 1 byte and 5 MB");
    }
  });

  it("normalizes a safe display filename without using it as an object key", () => {
    expect(normalizeSongArtworkFileName("  cover final.png  ")).toBe("cover final.png");
    expect(() => normalizeSongArtworkFileName("../cover.png")).toThrow();
    expect(() => normalizeSongArtworkFileName("cover\n.png")).toThrow();
  });

  it("accepts bounded opaque ETags and rejects header injection", () => {
    expect(assertSongArtworkObjectEtag('  "etag-1"  ')).toBe('"etag-1"');
    expect(() => assertSongArtworkObjectEtag("etag\r\nx: bad")).toThrow();
    expect(() => assertSongArtworkObjectEtag(" ")).toThrow();
  });
});
