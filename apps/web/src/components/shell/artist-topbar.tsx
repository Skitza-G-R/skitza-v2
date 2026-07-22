"use client";

import { AppTopBar } from "./app-topbar";

// Artist-side wrapper around the shared `AppTopBar`. Mirrors the
// producer wrapper but with the artist's section labels and
// artist-appropriate section labels. Search and notifications stay omitted
// until working artist surfaces exist. The explicit
// artist variant preserves the compact translucent SK-31 chrome while the
// producer variant adopts SK-76's opaque 64px control strip.

const ARTIST_SECTIONS = {
  "/artist": "Home",
  "/artist/music": "Music",
  "/artist/book": "Book",
  "/artist/store": "Store",
  "/artist/payments": "Payments",
  "/artist/settings": "Settings",
} as const;

const ARTIST_FALLBACK = { path: "/artist", label: "Home" };

export function ArtistTopBar() {
  return (
    <AppTopBar
      variant="artist"
      sections={ARTIST_SECTIONS}
      fallback={ARTIST_FALLBACK}
      searchPlaceholder="Search your music, sessions, store…"
    />
  );
}
