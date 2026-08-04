"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
} from "~/lib/runtime-state/navigation-cache";
import type { Studio } from "~/server/artist/identity";

import { isArtistNavItemActive } from "./artist-nav-active";
import type { IconName } from "./icons";
import { LiquidGlassBottomNav, type LiquidGlassBottomNavTab } from "./liquid-glass-bottom-nav";

type ArtistTabId = "home" | "music" | "sessions" | "payments" | "store";

type ArtistTab = {
  id: ArtistTabId;
  href: string;
  label: string;
  icon: IconName;
};

const TABS: readonly ArtistTab[] = [
  { href: "/artist", label: "Home", icon: "home", id: "home" },
  { href: "/artist/music", label: "Music", icon: "music", id: "music" },
  { href: "/artist/sessions", label: "Sessions", icon: "calendar", id: "sessions" },
  { href: "/artist/payments", label: "Payments", icon: "payments", id: "payments" },
  { href: "/artist/store", label: "Store", icon: "store", id: "store" },
] as const;

/**
 * Artist adapter for the shared liquid-glass surface. Artist routes remain
 * studio-aware and the frame remains fixed because the artist shell still
 * uses document scrolling on mobile.
 */
export function ArtistBottomNav({
  studios,
  initialStudioId,
}: {
  studios: Studio[];
  initialStudioId: string | null;
}): ReactNode {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStudioId = resolveArtistStudioId(
    studios,
    searchParams.get("studio"),
    initialStudioId,
  );
  const tabs: readonly LiquidGlassBottomNavTab<ArtistTabId>[] = TABS.map((tab) => ({
    ...tab,
    href: withArtistStudio(tab.href, activeStudioId),
    active: isArtistNavItemActive(pathname, tab.href),
    prefetch: false,
  }));

  return (
    <LiquidGlassBottomNav
      ariaLabel="Artist app tabs"
      tabs={tabs}
      position="fixed"
      frameClassName="artist-bottom-nav-frame"
      onTabClick={(event) => {
        captureRuntimeMainNavigationTarget(event.currentTarget);
      }}
      onTabNavigate={(tab) => {
        announceRuntimeMainNavigationIntent(tab.href);
      }}
    />
  );
}
