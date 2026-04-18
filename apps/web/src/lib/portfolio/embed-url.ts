// Portfolio embed URL parser + resolver.
//
// Pro producers often want to showcase tracks they don't own the
// masters to (Spotify, SoundCloud, YouTube, Apple Music). Rather than
// force an R2 audio upload we accept the public share URL, detect the
// source, and render the platform's official embed iframe on the
// public portfolio page.
//
// This file is pure (no fetch, no imports from our app) — trivial to
// unit-test and to call from both server and client.

export type EmbedSource = "spotify" | "soundcloud" | "youtube" | "apple";
export type EmbedInfo = { source: EmbedSource; embedUrl: string } | null;

/**
 * Parse a user-pasted URL and, if it matches one of our supported
 * streaming platforms, return the platform's embed URL. Returns null
 * for unrecognized / malformed input so callers can fall back to the
 * native TrackPlayer.
 */
export function parseEmbedUrl(raw: string): EmbedInfo {
  const url = raw.trim();
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");

  // Spotify: open.spotify.com/{track|album|playlist}/{id}
  //   → open.spotify.com/embed/{kind}/{id}
  if (host === "open.spotify.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    // Optional locale prefix: /intl-xx/track/...
    const maybeLocale = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    const kind = maybeLocale[0];
    const id = maybeLocale[1];
    if (
      kind &&
      (kind === "track" || kind === "album" || kind === "playlist") &&
      id &&
      /^[A-Za-z0-9]+$/.test(id)
    ) {
      return { source: "spotify", embedUrl: `https://open.spotify.com/embed/${kind}/${id}` };
    }
  }

  // SoundCloud: soundcloud.com/{artist}/{slug} (and on.soundcloud.com).
  // Uses the official HTML5 widget, passing the source URL through.
  if (host === "soundcloud.com" || host === "on.soundcloud.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      const embedUrl =
        `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}` +
        `&color=%23c98a0a&inverse=false&auto_play=false&show_user=true`;
      return { source: "soundcloud", embedUrl };
    }
  }

  // YouTube long form: youtube.com/watch?v={id}
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
      return { source: "youtube", embedUrl: `https://www.youtube.com/embed/${v}` };
    }
  }
  // YouTube short form: youtu.be/{id}
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { source: "youtube", embedUrl: `https://www.youtube.com/embed/${id}` };
    }
  }

  // Apple Music: music.apple.com/{country}/album/{slug}/{id}?i={trackId}
  // Apple's own embed host is embed.music.apple.com with the same
  // pathname + querystring.
  if (host === "music.apple.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    // Require a recognizable shape: /{country}/{album|song|playlist}/...
    if (parts.length >= 3) {
      return {
        source: "apple",
        embedUrl: `https://embed.music.apple.com${u.pathname}${u.search}`,
      };
    }
  }

  return null;
}

/** Human-readable label used in the paste preview chip. */
export function embedSourceLabel(src: EmbedSource): string {
  switch (src) {
    case "spotify":
      return "Spotify";
    case "soundcloud":
      return "SoundCloud";
    case "youtube":
      return "YouTube";
    case "apple":
      return "Apple Music";
  }
}
