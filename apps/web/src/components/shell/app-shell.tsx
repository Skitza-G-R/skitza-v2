import type { ReactNode } from "react";

import { PersistentPlayer } from "~/components/audio/persistent-player";
import { ProducerBottomNav } from "~/components/nav/producer-bottom-nav";
import { ProducerSidebar } from "~/components/nav/producer-sidebar";
import { RuntimeNavigationBridge } from "~/components/runtime-state/runtime-navigation-bridge";
import { RuntimeStateProvider } from "~/components/runtime-state/runtime-state-provider";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { getShellState } from "~/server/shell-data";

import { CommandPaletteTrigger } from "./command-palette-trigger";
import { DashboardTopBar } from "./dashboard-topbar";
import { ShortcutsBridge } from "./shortcuts-bridge";
import { TopBarBreadcrumbProvider } from "./topbar-breadcrumb-context";

// AppShell — Phase 2 (locked design system).
//
// Hosts the dark sidebar (lg+) + dark mobile bottom nav (<lg) + the
// warm canvas main content. Hosted from the shared dashboard/layout
// (per the architecture test in
// apps/web/src/app/(producer)/dashboard/__tests__/layout-architecture.test.ts)
// so the shell instance survives sibling-route navigation. The
// architecture invariants:
//   1. dashboard/layout.tsx imports + renders <AppShell> from
//      "~/components/shell/app-shell".
//   2. No file under dashboard/**/page.tsx imports AppShell.
// Both are pinned via the source-level test above.
//
// Stays a server component so we can `await getShellState()` once per
// render (slug + unread count + recent active items used by the
// notification bell). Per-request memoisation via React.cache() keeps
// the cost flat as child server components opt into the same data.
//
// Existing infrastructure preserved (Phase 2 brief = chrome only,
// don't touch features):
//   - PersistentPlayer    — singleton audio player, custom-event bus.
//   - CommandPaletteTrigger — ⌘K palette (deferred from new chrome,
//     stays functional via the keyboard shortcut).
//   - ShortcutsBridge     — keyboard shortcut dispatcher.
//
// Phase 4 swaps PersistentPlayer for the new dark FloatingPlayer; for
// now the existing player renders alongside the new chrome and looks
// stylistically mismatched on mobile. Documented in
// docs/qa/phase-2-handoff.md under "FloatingPlayer slot".

export async function AppShell({ children }: { children: ReactNode }) {
  const { userId, producerId, slug, displayName, plan, unreadCount, recentNotifications } =
    await getShellState();
  // Public origin used by the SidebarShareChip to render the
  // /join/<slug> URL. Always the canonical brand origin — share links
  // land in producer bios + socials, so they must always read as
  // `skitza.app/join/<slug>`, regardless of which deployment generated
  // them. See `lib/share/public-url` for the rationale.
  const publicBaseUrl = PUBLIC_BRAND_ORIGIN;

  const shell = (
    <div
      className="fixed inset-0 flex overflow-hidden lg:static lg:min-h-dvh lg:overflow-visible"
      style={{
        background: "rgb(var(--bg-background))",
        color: "rgb(var(--fg-default))",
      }}
    >
      <ProducerSidebar
        producerSlug={slug}
        publicBaseUrl={publicBaseUrl}
        displayName={displayName}
        plan={plan}
      />
      {/* Mobile behaves as one native-style viewport: page content is
          the only scrolling region and the tab bar is a non-scrolling
          footer. Long nested routes therefore cannot turn html/body into
          a different scroll viewport and detach the nav from the visible
          phone edge. Desktop keeps its existing document-scroll layout. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain lg:overflow-visible lg:overscroll-auto"
        >
          {/* Sticky topbar from the HTML mockup: breadcrumb · search
              trigger · notifications bell. Sits at the top of <main> so
              it spans the content area (not the sidebar), and uses
              position:sticky so it stays pinned during scroll without
              stealing focus order from the page below. Wrapped in the
              TopBarBreadcrumb provider so deep pages can publish their
              own crumbs (client name, project title, song title) to the
              single topbar surface instead of rendering a duplicate
              breadcrumb of their own.

              SK-76 makes this an opaque 64px strip, so content follows it
              in normal flow with no negative overlap. */}
          <TopBarBreadcrumbProvider>
            <DashboardTopBar
              producerSlug={slug}
              unreadCount={unreadCount}
              recentNotifications={recentNotifications}
            />
            {children}
          </TopBarBreadcrumbProvider>
        </main>

        <ProducerBottomNav />
      </div>

      {/* Phase 2 floating-player slot — the existing PersistentPlayer
          stays mounted so audio playback works across the dashboard.
          Phase 4 will swap it for the new dark `FloatingPlayer` from
          the locked design (notes/shell.jsx); the audio bus that
          drives it is a window CustomEvent stream, so the swap is a
          drop-in replacement at this exact mount point. */}
      <PersistentPlayer />

      {/* Global producer controls. */}
      <CommandPaletteTrigger />
      <ShortcutsBridge />
    </div>
  );

  if (!userId || !producerId) return shell;

  return (
    <RuntimeStateProvider identity={{ userId, role: "producer", contextId: producerId }}>
      <RuntimeNavigationBridge />
      {shell}
    </RuntimeStateProvider>
  );
}
