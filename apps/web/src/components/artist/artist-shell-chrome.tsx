"use client";

import { usePathname } from "next/navigation";

import { isArtistPurchasePath } from "./artist-shell-route";

/**
 * Purchase routes are focused, full-screen flows. Keeping the normal artist
 * sidebar, top bar, players, and bottom navigation mounted behind them leaves
 * visually hidden controls in the keyboard order. This gate removes that
 * chrome from the DOM for the whole purchase funnel.
 */
export function ArtistShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isArtistPurchasePath(pathname)) return null;
  return children;
}
