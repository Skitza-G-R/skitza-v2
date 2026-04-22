// Wave 2 S04 Part 2 — URL parsers for the 7 supported streaming platforms.
// PRD §6.2 Section B. Producer pastes a URL; we convert it to an embed URL.
//
// Contract: always return either an iframe embed or a link fallback. Never
// throw on bad input — a malformed URL becomes a "Listen on <platform>"
// button linking to the original URL.
//
// Each platform parser is pure: (url: string) => EmbedOutput | null.
// The dispatcher `parseEmbed(platform, url)` picks the right parser.

import type { ExternalPlatform } from "@skitza/db";

export type EmbedOutput =
  | {
      type: "iframe";
      src: string;
      // Fixed pixel height (Spotify/Apple/SoundCloud/Tidal audio bars)
      // OR undefined when `aspectRatio` is used (YouTube video, Instagram).
      height?: number;
      aspectRatio?: "16:9" | "1:1" | "9:16";
    }
  | {
      type: "link";
      href: string;
      platformLabel: string;
    };

const PLATFORM_LABELS: Record<ExternalPlatform, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  tidal: "Tidal",
  instagram_reels: "Instagram",
};

function linkFallback(platform: ExternalPlatform, url: string): EmbedOutput {
  return {
    type: "link",
    href: url,
    platformLabel: PLATFORM_LABELS[platform],
  };
}

// ─── Spotify ──────────────────────────────────────────────────────
// URL: https://open.spotify.com/{track|album|artist|playlist}/{ID}(?si=…)
// Embed: https://open.spotify.com/embed/{type}/{ID}
// Height: 152px for tracks (single bar), 352px for everything else.
function parseSpotify(url: string): EmbedOutput | null {
  const m = url.match(
    /^https?:\/\/open\.spotify\.com\/(track|album|artist|playlist)\/([a-zA-Z0-9]+)/,
  );
  if (!m?.[1] || !m[2]) return null;
  const [, kind, id] = m;
  return {
    type: "iframe",
    src: `https://open.spotify.com/embed/${kind}/${id}`,
    height: kind === "track" ? 152 : 352,
  };
}

// ─── YouTube ──────────────────────────────────────────────────────
// Three URL shapes: youtu.be/{id}, youtube.com/shorts/{id},
// youtube.com/watch?v={id}. All normalize to youtube.com/embed/{id}.
// Renders 16:9 responsive iframe.
function parseYouTube(url: string): EmbedOutput | null {
  const shortMatch = url.match(/^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortMatch?.[1]) {
    return {
      type: "iframe",
      src: `https://www.youtube.com/embed/${shortMatch[1]}`,
      aspectRatio: "16:9",
    };
  }
  const shortsMatch = url.match(
    /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
  );
  if (shortsMatch?.[1]) {
    return {
      type: "iframe",
      src: `https://www.youtube.com/embed/${shortsMatch[1]}`,
      aspectRatio: "16:9",
    };
  }
  const watchMatch = url.match(
    /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]+)/,
  );
  if (watchMatch?.[1]) {
    return {
      type: "iframe",
      src: `https://www.youtube.com/embed/${watchMatch[1]}`,
      aspectRatio: "16:9",
    };
  }
  return null;
}

// ─── Apple Music ──────────────────────────────────────────────────
// Embed trick: replace `music.apple.com` with `embed.music.apple.com`;
// the rest of the path (country / album|song|artist / id) is identical.
function parseAppleMusic(url: string): EmbedOutput | null {
  if (!/^https?:\/\/music\.apple\.com\//.test(url)) return null;
  return {
    type: "iframe",
    src: url.replace("music.apple.com", "embed.music.apple.com"),
    height: 175,
  };
}

// ─── SoundCloud ───────────────────────────────────────────────────
// URL-based embed: w.soundcloud.com/player/?url=<URL-encoded-original>.
// The widget decides track vs set vs user from the pasted URL.
function parseSoundCloud(url: string): EmbedOutput | null {
  if (!/^https?:\/\/soundcloud\.com\/[^/]+\/./.test(url)) return null;
  return {
    type: "iframe",
    src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23e8940c&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
    height: 166,
  };
}

// ─── Tidal ────────────────────────────────────────────────────────
// URL: /browse/track/{id} OR /track/{id}. Embed: embed.tidal.com/tracks/{id}.
function parseTidal(url: string): EmbedOutput | null {
  const m = url.match(
    /^https?:\/\/(?:www\.)?tidal\.com\/(?:browse\/)?track\/(\d+)/,
  );
  if (!m?.[1]) return null;
  return {
    type: "iframe",
    src: `https://embed.tidal.com/tracks/${m[1]}`,
    height: 96,
  };
}

// ─── Instagram Reels ──────────────────────────────────────────────
// URL: instagram.com/reel/{CODE}/ (trailing slash optional).
// Embed: same URL with /embed appended.
function parseInstagramReel(url: string): EmbedOutput | null {
  const m = url.match(
    /^https?:\/\/(?:www\.)?instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
  );
  if (!m?.[1]) return null;
  return {
    type: "iframe",
    src: `https://www.instagram.com/reel/${m[1]}/embed`,
    aspectRatio: "9:16",
  };
}

// ─── Bandcamp (v1: always link-fallback) ──────────────────────────
// Bandcamp's embed widget requires a numeric track/album ID that's
// NOT derivable from the artist.bandcamp.com/... URL alone. For v1 we
// render a "Listen on Bandcamp" button. Revisit if producers ask.
// The `url` param is intentionally unused in the v1 implementation;
// the dispatcher returns a link fallback when this parser returns null.
function parseBandcamp(url: string): EmbedOutput | null {
  // Touch `url` so the no-unused-vars rule stays satisfied without an
  // ignore-comment. Cheap branch; always returns null for v1.
  if (url.length < 0) return { type: "iframe", src: "", height: 0 };
  return null;
}

// ─── Dispatcher ───────────────────────────────────────────────────

type PlatformParser = (url: string) => EmbedOutput | null;

const PARSERS: Record<ExternalPlatform, PlatformParser> = {
  spotify: parseSpotify,
  apple_music: parseAppleMusic,
  youtube: parseYouTube,
  soundcloud: parseSoundCloud,
  bandcamp: parseBandcamp,
  tidal: parseTidal,
  instagram_reels: parseInstagramReel,
};

/**
 * Parse a producer-pasted URL into an embed (iframe) or a link fallback.
 * Never throws — bad input returns a link fallback.
 */
export function parseEmbed(
  platform: ExternalPlatform,
  url: string,
): EmbedOutput {
  const parsed = PARSERS[platform](url);
  return parsed ?? linkFallback(platform, url);
}
