import type { Studio } from "~/server/artist/identity";

import { PersistentPlayer } from "~/components/audio/persistent-player";
import { ArtistBottomNav } from "~/components/nav/artist-bottom-nav";
import { ArtistDesktopSidebar } from "~/components/nav/artist-desktop-sidebar";
import { ArtistMobileTopBar } from "~/components/nav/artist-mobile-top-bar";
import { ArtistTopBar } from "~/components/shell/artist-topbar";
import { TopBarBreadcrumbProvider } from "~/components/shell/topbar-breadcrumb-context";
import { ArtistRuntimeStateProvider } from "~/components/runtime-state/artist-runtime-state-provider";
import { NativeInstallGuidance } from "~/components/pwa/native-install-guidance";

import { ArtistHomeSoftNavigationBoundary } from "./home/artist-home-runtime";
import { ArtistShellChrome } from "./artist-shell-chrome";
import { ArtistRouteStatus } from "./artist-route-status";

// Artist app shell — Phase 2 (locked design system).
//
// Two responsive surfaces, switching at the canonical `lg` breakpoint
// (1024px, per Gili's Q1 ruling — iPads in both orientations get
// mobile UI; only laptops/desktops see the sidebar):
//
//   Mobile (<lg):
//     warm-canvas top bar   (Wordmark + StudioSwitcher + UserButton)
//     main content          (warm canvas, scrollable)
//     dark bottom nav       (5 tabs: Home / Music / Book / Store / Payments)
//
//   Desktop (lg+):
//     dark left sidebar     (Wordmark + 5 nav items + UserButton)
//     main content          (warm canvas, scrollable)
//
// `isProducer` is intentionally consumed inside the responsive layout
// so the "Producer dashboard" backlink in Clerk's UserButton menu
// remains available to dual-role users on every artist surface. The
// menu is rendered inside the relevant chrome — desktop sidebar bottom
// for `lg+`, mobile top bar for `<lg` — with the same labelled link.
//
// Audio: AppMediaRuntime owns the singleton app-level engine.
// PersistentPlayer remains the route-shell presentation for the shared
// player state and event bus.
//
// Per CLAUDE.md the artist platform is mobile-first; the desktop
// surface is net-new in Phase 2 (the prior implementation rendered
// the same single-column layout at every viewport).
export function ArtistAppShell({
  userId,
  isProducer: _isProducer,
  studios,
  children,
}: {
  userId: string;
  isProducer: boolean;
  studios: Studio[];
  children: React.ReactNode;
}) {
  // `_isProducer` parked in scope so the prior call-site signature is
  // preserved; Phase 2 doesn't render the dual-role UserButton menu
  // entry yet (the new chrome's UserButton appearance API is still
  // under design — landing in Phase 3 with the redesigned menu surface).
  // Same data is fetched so re-introduction is a no-op for the layout.
  void _isProducer;
  const runtimeCacheEpoch = Date.now();

  return (
    <ArtistRuntimeStateProvider
      userId={userId}
      studioIds={studios.map((studio) => studio.producerId)}
      cacheEpoch={runtimeCacheEpoch}
    >
      <NativeInstallGuidance role="artist" />
      <div
        className="flex min-h-dvh"
        style={{
          background: "rgb(var(--bg-background))",
          color: "rgb(var(--fg-default))",
        }}
      >
        {/* Desktop-only left rail. `hidden lg:flex` is set inside the
            sidebar component so this fragment stays declarative. */}
        <ArtistShellChrome>
          <ArtistDesktopSidebar studios={studios} />
        </ArtistShellChrome>

        {/* Main column — top bar (mobile only) + content + bottom nav
            (mobile only). Flex-column so the top bar sits flush above
            scrolling content. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <ArtistShellChrome>
            <ArtistMobileTopBar studios={studios} />
          </ArtistShellChrome>
          {/* SK-31: replicate the producer top bar on the artist side,
              desktop only. The `<TopBarBreadcrumbProvider>` wraps both
              the topbar and `<main>` so deep artist pages can push
              extra crumbs (song title, booking detail, etc.) into the
              single sticky topbar surface — same mechanism the
              producer side uses. The `hidden lg:block` wrapper keeps
              this strip off mobile, where the existing
              `ArtistMobileTopBar` continues to own the top of the
              screen (per Gili's SK-31 decision). */}
          <TopBarBreadcrumbProvider>
            <ArtistShellChrome>
              <div className="hidden lg:block">
                <ArtistTopBar />
              </div>
            </ArtistShellChrome>
            {/* The mobile bottom padding reserves the 76px tab bar,
                iPhone Home Indicator inset, and 16px content buffer.
                `lg:pb-12` keeps desktop spacing unchanged where there's
                no bar. `pt-6 lg:pt-10` matches the design's top spacing.
                `mx-auto max-w-2xl` keeps the artist content column
                readable at tablet+ widths even on the desktop sidebar
                layout — Phase 3 pages can opt out by setting their own
                width. */}
            <main
              id="main-content"
              tabIndex={-1}
              className="mx-auto w-full max-w-2xl px-4 pt-6 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:max-w-none lg:px-10 lg:pt-10 lg:pb-12"
            >
              <ArtistRouteStatus />
              <ArtistHomeSoftNavigationBoundary>{children}</ArtistHomeSoftNavigationBoundary>
            </main>
          </TopBarBreadcrumbProvider>
        </div>

        <ArtistShellChrome>
          {/* PersistentPlayer powers the shared Music Library's Play
              buttons through the app-level playback runtime. */}
          <PersistentPlayer />
          <ArtistBottomNav studios={studios} />
        </ArtistShellChrome>
      </div>
    </ArtistRuntimeStateProvider>
  );
}
