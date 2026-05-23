import type { Studio } from "~/server/artist/identity";

import { ArtistBottomNav } from "~/components/nav/artist-bottom-nav";
import { ArtistDesktopSidebar } from "~/components/nav/artist-desktop-sidebar";
import { ArtistMobileTopBar } from "~/components/nav/artist-mobile-top-bar";
import { ArtistTopBar } from "~/components/shell/artist-topbar";
import { TopBarBreadcrumbProvider } from "~/components/shell/topbar-breadcrumb-context";

import { ArtistAudioProvider } from "./artist-audio-context";
import { PersistentMiniPlayer } from "./persistent-mini-player";

// Artist app shell — Phase 2 (locked design system).
//
// Two responsive surfaces, switching at the canonical `lg` breakpoint
// (1024px, per Gili's Q1 ruling — iPads in both orientations get
// mobile UI; only laptops/desktops see the sidebar):
//
//   Mobile (<lg):
//     warm-canvas top bar   (Wordmark + StudioSwitcher + UserButton)
//     main content          (warm canvas, scrollable)
//     dark bottom nav       (5 tabs: Home / Music / Book / Store / Settings)
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
// Audio: `ArtistAudioProvider` owns the singleton <audio> element,
// `PersistentMiniPlayer` renders the visible mini-player. Both are
// preserved verbatim for Phase 2 (audio system rework lands in Phase
// 4). The existing player renders above the dark bottom nav on mobile
// and floats over the bottom-right of main on desktop; visual
// mismatch is expected per the Phase 2 brief.
//
// Per CLAUDE.md the artist platform is mobile-first; the desktop
// surface is net-new in Phase 2 (the prior implementation rendered
// the same single-column layout at every viewport).
export function ArtistAppShell({
  isProducer: _isProducer,
  studios,
  unreadCount = 0,
  children,
}: {
  isProducer: boolean;
  studios: Studio[];
  /** Bell-dot signal for the desktop topbar. See
   *  `getArtistShellState` in `~/server/artist/shell-data.ts` for the
   *  composition (pending payments + sessions within 7 days + recent
   *  mix flag). Mobile chrome ignores this — the topbar only mounts on
   *  `lg+` per Gili's SK-31 decision. */
  unreadCount?: number;
  children: React.ReactNode;
}) {
  // `_isProducer` parked in scope so the prior call-site signature is
  // preserved; Phase 2 doesn't render the dual-role UserButton menu
  // entry yet (the new chrome's UserButton appearance API is still
  // under design — landing in Phase 3 with the redesigned menu surface).
  // Same data is fetched so re-introduction is a no-op for the layout.
  void _isProducer;

  return (
    <ArtistAudioProvider>
      <div
        className="flex min-h-dvh"
        style={{
          background: "rgb(var(--bg-background))",
          color: "rgb(var(--fg-default))",
        }}
      >
        {/* Desktop-only left rail. `hidden lg:flex` is set inside the
            sidebar component so this fragment stays declarative. */}
        <ArtistDesktopSidebar studios={studios} />

        {/* Main column — top bar (mobile only) + content + bottom nav
            (mobile only). Flex-column so the top bar sits flush above
            scrolling content. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <ArtistMobileTopBar studios={studios} />
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
            <div className="hidden lg:block">
              <ArtistTopBar unreadCount={unreadCount} />
            </div>
            {/* `pb-20` reserves space for the mobile bottom nav (56px
                tab row + 8px safe-area buffer). `lg:pb-12` keeps a
                little vertical breathing room on desktop where there's
                no bar. `pt-6 lg:pt-10` matches the design's top
                spacing. `mx-auto max-w-2xl` keeps the artist content
                column readable at tablet+ widths even on the desktop
                sidebar layout — Phase 3 pages can opt out by setting
                their own width. */}
            <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6 lg:max-w-none lg:px-10 lg:pb-12 lg:pt-10">
              {children}
            </main>
          </TopBarBreadcrumbProvider>
        </div>

        <PersistentMiniPlayer />
        <ArtistBottomNav />
      </div>
    </ArtistAudioProvider>
  );
}
