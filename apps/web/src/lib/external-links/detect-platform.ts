import type { ExternalPlatform } from "@skitza/db";

// Smart-paste URL → platform detector. Pure, side-effect-free, used by
// the producerExternalLinks.add tRPC procedure to turn a producer-pasted
// URL into one of the seven supported platform enum values.
//
// Adding a new platform requires: a row here, the enum entry in
// packages/db/src/schema.ts, an embed component for /join, and a label
// in the PortfolioPanel platform-name map.
const HOST_MAP: Record<string, ExternalPlatform> = {
  "spotify.com": "spotify",
  "open.spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "youtu.be": "youtube",
  "soundcloud.com": "soundcloud",
  "www.soundcloud.com": "soundcloud",
  "bandcamp.com": "bandcamp",
  "tidal.com": "tidal",
  "www.tidal.com": "tidal",
  "instagram.com": "instagram_reels",
  "www.instagram.com": "instagram_reels",
};

export function detectPlatform(url: string): ExternalPlatform | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only http/https URLs are valid producer-facing links. Reject
  // javascript:, data:, mailto:, etc explicitly so the smart-paste
  // input can't be tricked into accepting a non-link string.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return HOST_MAP[parsed.host.toLowerCase()] ?? null;
}
