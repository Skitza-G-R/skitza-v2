import { describe, expect, it } from "vitest";

import { detectPlatform } from "../detect-platform";

describe("detectPlatform", () => {
  it.each([
    ["https://open.spotify.com/track/abc", "spotify"],
    ["https://spotify.com/artist/x", "spotify"],
    ["https://music.apple.com/us/album/y", "apple_music"],
    ["https://www.youtube.com/watch?v=z", "youtube"],
    ["https://youtube.com/watch?v=z", "youtube"],
    ["https://youtu.be/z", "youtube"],
    ["https://soundcloud.com/foo/bar", "soundcloud"],
    ["https://www.soundcloud.com/foo/bar", "soundcloud"],
    ["https://bandcamp.com/x", "bandcamp"],
    ["https://tidal.com/browse/track/1", "tidal"],
    ["https://www.tidal.com/track/1", "tidal"],
    ["https://www.instagram.com/reel/abc/", "instagram_reels"],
    ["https://instagram.com/reel/abc/", "instagram_reels"],
  ])("maps %s -> %s", (url, expected) => {
    expect(detectPlatform(url)).toBe(expected);
  });

  it("returns null for unknown hosts", () => {
    expect(detectPlatform("https://vimeo.com/123")).toBeNull();
    expect(detectPlatform("https://example.com/foo")).toBeNull();
  });

  it("returns null for malformed URLs without throwing", () => {
    expect(detectPlatform("not a url")).toBeNull();
    expect(detectPlatform("")).toBeNull();
    expect(detectPlatform("javascript:alert(1)")).toBeNull();
  });

  it("is case-insensitive on host", () => {
    expect(detectPlatform("https://OPEN.SPOTIFY.COM/track/abc")).toBe(
      "spotify",
    );
    expect(detectPlatform("https://YOUTU.BE/abc")).toBe("youtube");
  });

  it("ignores subpaths and query strings", () => {
    expect(
      detectPlatform(
        "https://open.spotify.com/track/abc?si=long-share-id&utm_source=x",
      ),
    ).toBe("spotify");
  });
});
