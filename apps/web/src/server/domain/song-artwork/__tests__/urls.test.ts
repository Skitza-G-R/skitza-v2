import { describe, expect, it } from "vitest";

import { privateSongArtworkPath } from "../urls";

describe("private song artwork URLs", () => {
  it("keeps the read route stable for server read models", () => {
    expect(privateSongArtworkPath("track-id")).toBe("/api/song-artwork/track-id");
  });

  it("adds an opaque upload revision after replacement", () => {
    expect(privateSongArtworkPath("track-id", "upload/id")).toBe(
      "/api/song-artwork/track-id?v=upload%2Fid",
    );
  });
});
