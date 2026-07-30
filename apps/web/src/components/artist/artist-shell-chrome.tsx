"use client";

import { usePathname } from "next/navigation";

import { isArtistFocusedPath } from "./artist-shell-route";

/**
 * Focused artist flows remove the standing app chrome. Keeping the normal artist
 * sidebar, top bar, players, and bottom navigation mounted behind them leaves
 * visually hidden controls in the keyboard order. This gate removes that
 * chrome from the DOM for the whole purchase funnel.
 */
export function ArtistShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isArtistFocusedPath(pathname)) return null;
  return children;
}
