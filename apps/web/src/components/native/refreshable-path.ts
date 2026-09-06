// Which screens answer a pull-to-refresh.
//
// Kept as a plain `.ts` module — no "use client", no React, no browser
// APIs — so the shells, the gesture controller, and the tests can all
// share one list instead of each re-deriving it from the nav configs.
//
// The line we draw: pull-to-refresh belongs on the screens a producer or
// artist *reads* (the bottom-nav tabs plus the two producer workspaces
// that SK-306 moved into the account sheet). It stays off the screens
// they *fill in* — settings, profile, portfolio, onboarding — and off
// every detail page, where a refresh is a surprise rather than a
// shortcut. Focused flows never mount the controller at all.

export type PullToRefreshShell = "producer" | "artist";

const PRODUCER_MAIN_SCREENS: readonly string[] = [
  "/dashboard",
  "/dashboard/music",
  "/dashboard/clients-projects",
  "/dashboard/calendar",
  "/dashboard/store",
  "/dashboard/payments",
  "/dashboard/requests",
] as const;

const ARTIST_MAIN_SCREENS: readonly string[] = [
  "/artist",
  "/artist/music",
  "/artist/sessions",
  "/artist/payments",
  "/artist/store",
] as const;

export function normalizedPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * True when `pathname` is one of the shell's main screens. Detail pages
 * under a main screen (a client, a song, a proof) are deliberately not
 * refreshable — the gesture still moves elastically there, it just does
 * not reload.
 */
export function isRefreshablePath(pathname: string, shell: PullToRefreshShell): boolean {
  const screens = shell === "producer" ? PRODUCER_MAIN_SCREENS : ARTIST_MAIN_SCREENS;
  return screens.includes(normalizedPath(pathname));
}
