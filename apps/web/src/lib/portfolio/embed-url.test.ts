import { describe, it, expect } from "vitest";
import { parseEmbedUrl, embedSourceLabel } from "./embed-url";

describe("parseEmbedUrl — Spotify", () => {
  it("parses a track URL", () => {
    expect(parseEmbedUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toEqual({
      source: "spotify",
      embedUrl: "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT",
    });
  });
  it("parses an album URL", () => {
    expect(parseEmbedUrl("https://open.spotify.com/album/5vkqYmiPBYLaalcmjujWxK")).toEqual({
      source: "spotify",
      embedUrl: "https://open.spotify.com/embed/album/5vkqYmiPBYLaalcmjujWxK",
    });
  });
  it("parses a playlist URL", () => {
    expect(parseEmbedUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      source: "spotify",
      embedUrl: "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M",
    });
  });
  it("ignores query parameters on the original URL", () => {
    const res = parseEmbedUrl(
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123",
    );
    expect(res?.source).toBe("spotify");
    expect(res?.embedUrl).toBe(
      "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT",
    );
  });
  it("handles intl locale prefix", () => {
    expect(
      parseEmbedUrl("https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT"),
    ).toEqual({
      source: "spotify",
      embedUrl: "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT",
    });
  });
  it("rejects a non-track Spotify path", () => {
    expect(parseEmbedUrl("https://open.spotify.com/user/someone")).toBeNull();
  });
});

describe("parseEmbedUrl — SoundCloud", () => {
  it("returns the widget URL with the raw URL encoded", () => {
    const res = parseEmbedUrl("https://soundcloud.com/artist-name/some-track");
    expect(res?.source).toBe("soundcloud");
    expect(res?.embedUrl).toContain("w.soundcloud.com/player/?url=");
    expect(res?.embedUrl).toContain(
      encodeURIComponent("https://soundcloud.com/artist-name/some-track"),
    );
  });
  it("accepts on.soundcloud.com short links", () => {
    const res = parseEmbedUrl("https://on.soundcloud.com/abc123");
    expect(res?.source).toBe("soundcloud");
  });
});

describe("parseEmbedUrl — YouTube", () => {
  it("parses a long-form watch URL", () => {
    expect(parseEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      source: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });
  it("parses a youtu.be short URL", () => {
    expect(parseEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      source: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });
  it("rejects malformed video id", () => {
    expect(parseEmbedUrl("https://youtu.be/not-a-valid-id-far-too-long")).toBeNull();
  });
});

describe("parseEmbedUrl — Apple Music", () => {
  it("returns the embed host with the same pathname + query", () => {
    const res = parseEmbedUrl(
      "https://music.apple.com/us/album/the-dark-side-of-the-moon/1065973699?i=1065973703",
    );
    expect(res?.source).toBe("apple");
    expect(res?.embedUrl).toBe(
      "https://embed.music.apple.com/us/album/the-dark-side-of-the-moon/1065973699?i=1065973703",
    );
  });
});

describe("parseEmbedUrl — invalid input", () => {
  it("returns null for empty string", () => {
    expect(parseEmbedUrl("")).toBeNull();
  });
  it("returns null for whitespace", () => {
    expect(parseEmbedUrl("   ")).toBeNull();
  });
  it("returns null for a non-URL", () => {
    expect(parseEmbedUrl("not a url")).toBeNull();
  });
  it("returns null for an unrelated host", () => {
    expect(parseEmbedUrl("https://example.com/song.mp3")).toBeNull();
  });
});

describe("embedSourceLabel", () => {
  it("has a human label for each source", () => {
    expect(embedSourceLabel("spotify")).toBe("Spotify");
    expect(embedSourceLabel("soundcloud")).toBe("SoundCloud");
    expect(embedSourceLabel("youtube")).toBe("YouTube");
    expect(embedSourceLabel("apple")).toBe("Apple Music");
  });
});
