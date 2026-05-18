import { describe, it, expect } from "vitest";

import { parseEmbed } from "./parsers";

// Wave 2 S04 Part 2 — embed URL parsers for the 7 supported streaming
// platforms (PRD §6.2 Section B). Producer pastes a URL on Setup →
// External links; we parse it into an embed URL on render. Untrusted
// input (user-pasted), so bad input must fall back to a plain "Listen
// on <platform>" link, never crash. That fallback is the contract this
// test suite pins alongside the happy paths.
//
// Per-platform URL shapes we accept:
//   Spotify:          open.spotify.com/{track|album|artist|playlist}/{ID}
//   Apple Music:      music.apple.com/{country}/{album|song|artist}/...{ID}
//   YouTube:          youtube.com/watch?v={ID} / youtu.be/{ID} / shorts/{ID}
//   SoundCloud:       soundcloud.com/{user}/{track}
//   Bandcamp:         {artist}.bandcamp.com/... → no reliable embed from URL
//                     alone (requires numeric track ID from og-image or API).
//                     Returns `link` fallback for v1.
//   Tidal:            tidal.com/browse/track/{ID} / tidal.com/track/{ID}
//   Instagram Reels:  instagram.com/reel/{CODE}/

describe("parseEmbed — Spotify", () => {
  it("parses a track URL → track embed", () => {
    const result = parseEmbed(
      "spotify",
      "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe(
      "https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh",
    );
    expect(result.height).toBe(152);
  });

  it("parses an album URL → album embed (taller)", () => {
    const result = parseEmbed(
      "spotify",
      "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/embed/album/");
    expect(result.height).toBe(352);
  });

  it("parses an artist URL → artist embed", () => {
    const result = parseEmbed(
      "spotify",
      "https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/embed/artist/");
  });

  it("parses a playlist URL → playlist embed", () => {
    const result = parseEmbed(
      "spotify",
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/embed/playlist/");
  });

  it("strips ?si= query params from the ID", () => {
    const result = parseEmbed(
      "spotify",
      "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc123",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe(
      "https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh",
    );
  });

  it("falls back to link for an unparseable Spotify URL", () => {
    const result = parseEmbed("spotify", "https://spotify.com/not-a-real-url");
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — YouTube", () => {
  it("parses a standard watch URL", () => {
    const result = parseEmbed(
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("parses a youtu.be short URL", () => {
    const result = parseEmbed("youtube", "https://youtu.be/dQw4w9WgXcQ");
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("parses a shorts URL", () => {
    const result = parseEmbed(
      "youtube",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("strips other query params", () => {
    const result = parseEmbed(
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=abc",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("falls back to link for an unparseable YouTube URL", () => {
    const result = parseEmbed("youtube", "https://youtube.com/");
    expect(result.type).toBe("link");
  });

  it("uses 16:9 aspect ratio (no fixed height)", () => {
    const result = parseEmbed(
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    if (result.type !== "iframe") return;
    expect(result.aspectRatio).toBe("16:9");
  });
});

describe("parseEmbed — Apple Music", () => {
  it("rewrites music.apple.com → embed.music.apple.com", () => {
    const result = parseEmbed(
      "apple_music",
      "https://music.apple.com/us/album/1989-taylors-version/1713845538",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toBe(
      "https://embed.music.apple.com/us/album/1989-taylors-version/1713845538",
    );
  });

  it("preserves country code", () => {
    const result = parseEmbed(
      "apple_music",
      "https://music.apple.com/il/song/shake-it-off/1713845539",
    );
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/il/");
  });

  it("falls back to link for non-music.apple.com URLs", () => {
    const result = parseEmbed("apple_music", "https://apple.com/music");
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — SoundCloud", () => {
  it("URL-encodes the target into the embed player", () => {
    const result = parseEmbed(
      "soundcloud",
      "https://soundcloud.com/artist/track-name",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("w.soundcloud.com/player/");
    expect(result.src).toContain(
      encodeURIComponent("https://soundcloud.com/artist/track-name"),
    );
  });

  it("falls back to link for non-soundcloud.com URLs", () => {
    const result = parseEmbed("soundcloud", "https://example.com/foo");
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — Tidal", () => {
  it("parses tidal.com/browse/track/{id}", () => {
    const result = parseEmbed(
      "tidal",
      "https://tidal.com/browse/track/128089472",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/tracks/128089472");
  });

  it("parses tidal.com/track/{id}", () => {
    const result = parseEmbed("tidal", "https://tidal.com/track/128089472");
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("/tracks/128089472");
  });

  it("falls back to link for unparseable Tidal URLs", () => {
    const result = parseEmbed("tidal", "https://tidal.com/");
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — Instagram Reels", () => {
  it("parses /reel/{code}/ into an embed URL", () => {
    const result = parseEmbed(
      "instagram_reels",
      "https://www.instagram.com/reel/Cxyz123ABC/",
    );
    expect(result.type).toBe("iframe");
    if (result.type !== "iframe") return;
    expect(result.src).toContain("Cxyz123ABC");
    expect(result.src).toContain("/embed");
  });

  it("works without trailing slash", () => {
    const result = parseEmbed(
      "instagram_reels",
      "https://www.instagram.com/reel/Cxyz123ABC",
    );
    expect(result.type).toBe("iframe");
  });

  it("falls back to link for non-reel URLs", () => {
    const result = parseEmbed(
      "instagram_reels",
      "https://www.instagram.com/username/",
    );
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — Bandcamp (link fallback only for v1)", () => {
  it("always returns a link fallback — can't derive embed ID from URL alone", () => {
    const result = parseEmbed(
      "bandcamp",
      "https://artist.bandcamp.com/track/my-track",
    );
    expect(result.type).toBe("link");
    if (result.type !== "link") return;
    expect(result.href).toBe("https://artist.bandcamp.com/track/my-track");
  });

  it("link fallback also fires for album URLs", () => {
    const result = parseEmbed(
      "bandcamp",
      "https://artist.bandcamp.com/album/my-album",
    );
    expect(result.type).toBe("link");
  });
});

describe("parseEmbed — link fallback shape", () => {
  it("uses a human-readable platform label", () => {
    const result = parseEmbed("bandcamp", "https://anything.bandcamp.com/x");
    if (result.type !== "link") return;
    expect(result.platformLabel).toMatch(/bandcamp/i);
  });

  it("carries the original URL unchanged", () => {
    const url = "https://some-weird-spotify-url-that-wont-parse.com";
    const result = parseEmbed("spotify", url);
    if (result.type !== "link") return;
    expect(result.href).toBe(url);
  });
});

describe("parseEmbed — dispatcher type safety", () => {
  it("handles all 7 platform enum values without throwing", () => {
    const platforms = [
      "spotify",
      "apple_music",
      "youtube",
      "soundcloud",
      "bandcamp",
      "tidal",
      "instagram_reels",
    ] as const;
    for (const p of platforms) {
      expect(() =>
        parseEmbed(p, "https://example.com/whatever"),
      ).not.toThrow();
    }
  });

  it("always returns one of the two output shapes (iframe | link)", () => {
    const result = parseEmbed("spotify", "https://anything.com");
    expect(["iframe", "link"]).toContain(result.type);
  });
});
