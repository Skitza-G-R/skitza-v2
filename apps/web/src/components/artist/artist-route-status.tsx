"use client";

import { usePathname } from "next/navigation";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { isArtistFocusedPath } from "./artist-shell-route";

/**
 * Keeps connectivity feedback inside the persistent artist shell. The home
 * route owns a richer cached-view boundary; other already-rendered routes get
 * this compact status while every live mutation remains gated locally.
 */
export function ArtistRouteStatus() {
  const pathname = usePathname();
  const online = useOnlineStatus();

  if (online || pathname === "/artist" || isArtistFocusedPath(pathname)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-artist-route-offline
      className="mb-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]"
    >
      <span className="font-semibold text-[rgb(var(--fg-default))]">Offline.</span> This screen
      stays visible, but booking, payment, proof, and account changes need a connection.
    </div>
  );
}
