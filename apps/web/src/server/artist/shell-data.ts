import { cache } from "react";
import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";

import { artistNotificationUnreadCount } from "~/server/artist/notifications";

// Request-scoped shell state for the artist side. Mirrors the producer
// `getShellState()` helper — wrapping in `React.cache()` means
// downstream server components (the artist layout passes the state to
// the app shell, which forwards `unreadCount` to the topbar) share a
// single set of SELECTs per render.
//
// `unreadCount` is the durable per-recipient read state from the artist
// notification feed. It is no longer inferred from home-page activity.

export interface ArtistShellState {
  unreadCount: number;
}

const DEFAULT_STATE: ArtistShellState = { unreadCount: 0 };

export const getArtistShellState = cache(async (): Promise<ArtistShellState> => {
  const { userId } = await auth();
  if (!userId) return DEFAULT_STATE;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return DEFAULT_STATE;

  try {
    return {
      unreadCount: await artistNotificationUnreadCount(createDb(databaseUrl), userId),
    };
  } catch {
    // Shell chrome stays available if the feed cannot be loaded.
    return DEFAULT_STATE;
  }
});
