"use client";

import { AppTopBar } from "./app-topbar";

// Artist-side wrapper around the shared `AppTopBar`. Mirrors the
// producer wrapper but with the artist's section labels and
// artist-appropriate search placeholder copy. Click currently a no-op
// because the artist command palette ships in a separate task — the
// visual pill is identical to producer so the surfaces stay aligned.

const ARTIST_SECTIONS = {
  "/artist": "Home",
  "/artist/music": "Music",
  "/artist/book": "Book",
  "/artist/store": "Store",
  "/artist/settings": "Settings",
} as const;

const ARTIST_FALLBACK = { path: "/artist", label: "Home" };

interface ArtistTopBarProps {
  /** Unread count for the bell dot. Sum of pending payments,
   *  upcoming sessions within 7 days, and a flag for a recent mix. */
  unreadCount?: number;
}

export function ArtistTopBar({ unreadCount = 0 }: ArtistTopBarProps) {
  return (
    <AppTopBar
      sections={ARTIST_SECTIONS}
      fallback={ARTIST_FALLBACK}
      searchPlaceholder="Search your music, sessions, store…"
      unreadCount={unreadCount}
    />
  );
}
