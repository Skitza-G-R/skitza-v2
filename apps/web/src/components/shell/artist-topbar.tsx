"use client";

import { AppTopBar } from "./app-topbar";
import { ArtistNotificationBell } from "~/components/artist/artist-notification-bell";

// Artist-side wrapper around the shared `AppTopBar`. Mirrors the
// producer wrapper but with the artist's section labels and
// artist-appropriate section labels. The explicit
// artist variant preserves the compact translucent SK-31 chrome while the
// producer variant adopts SK-76's opaque 64px control strip.

const ARTIST_SECTIONS = {
  "/artist": "Home",
  "/artist/music": "Music",
  "/artist/sessions": "Sessions",
  "/artist/store": "Store",
  "/artist/purchase": "Store",
  "/artist/offers": "Store",
  "/artist/settings": "Settings",
} as const;

const ARTIST_FALLBACK = { path: "/artist", label: "Home" };

export function ArtistTopBar({ initialUnreadCount }: { initialUnreadCount: number }) {
  return (
    <AppTopBar
      variant="artist"
      sections={ARTIST_SECTIONS}
      fallback={ARTIST_FALLBACK}
      searchPlaceholder="Search your music, sessions, store…"
      notificationControl={<ArtistNotificationBell initialUnreadCount={initialUnreadCount} />}
    />
  );
}
