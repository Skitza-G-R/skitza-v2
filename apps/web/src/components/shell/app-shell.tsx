import type { ReactNode } from "react";

import { PersistentPlayer } from "~/components/audio/persistent-player";
import { ProducerBottomNav } from "~/components/nav/producer-bottom-nav";
import { ProducerSidebar } from "~/components/nav/producer-sidebar";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { getShellState } from "~/server/shell-data";

import { CoachmarkTour } from "./coachmark-tour";
import { CommandPaletteTrigger } from "./command-palette-trigger";
import { ShortcutsBridge } from "./shortcuts-bridge";

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
// render (slug + unread count + top-10 unread items used by the
// notification bell). Per-request memoisation via React.cache() keeps
// the cost flat as child server components opt into the same data.
//
// Existing infrastructure preserved (Phase 2 brief = chrome only,
// don't touch features):
//   - PersistentPlayer    — singleton audio player, custom-event bus.
//   - CommandPaletteTrigger — ⌘K palette (deferred from new chrome,
//     stays functional via the keyboard shortcut).
//   - ShortcutsBridge     — keyboard shortcut dispatcher.
//   - CoachmarkTour       — first-run guided tour.
//
// Phase 4 swaps PersistentPlayer for the new dark FloatingPlayer; for
// now the existing player renders alongside the new chrome and looks
// stylistically mismatched on mobile. Documented in
// docs/qa/phase-2-handoff.md under "FloatingPlayer slot".

export async function AppShell({ children }: { children: ReactNode }) {
  const { slug, unreadCount, unreadItems } = await getShellState();
  // Public origin used by the SidebarShareChip to render the
  // /join/<slug> URL. Always the canonical brand origin — share links
  // land in producer bios + socials, so they must always read as
  // `skitza.app/join/<slug>`, regardless of which deployment generated
  // them. See `lib/share/public-url` for the rationale.
  const publicBaseUrl = PUBLIC_BRAND_ORIGIN;

  return (
    <div
      className="flex min-h-dvh"
      style={{
        background: "rgb(var(--bg-background))",
        color: "rgb(var(--fg-default))",
      }}
    >
      <ProducerSidebar
        producerSlug={slug}
        publicBaseUrl={publicBaseUrl}
        unreadCount={unreadCount}
        unreadItems={unreadItems}
      />
      {/* `pb-20` on mobile reserves space for the fixed bottom nav
          (56px tab row + 8px safe-area buffer). `lg:pb-0` strips it
          on desktop where the bar isn't rendered. The skip-to-content
          target lives at the root layout (see app/layout.tsx) so we
          don't need a second link here. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="min-w-0 flex-1 pb-20 lg:pb-0"
      >
        {children}
      </main>

      <ProducerBottomNav />

      {/* Phase 2 floating-player slot — the existing PersistentPlayer
          stays mounted so audio playback works across the dashboard.
          Phase 4 will swap it for the new dark `FloatingPlayer` from
          the locked design (notes/shell.jsx); the audio bus that
          drives it is a window CustomEvent stream, so the swap is a
          drop-in replacement at this exact mount point. */}
      <PersistentPlayer />

      {/* Existing infrastructure — not touched by Phase 2. */}
      <CommandPaletteTrigger />
      <ShortcutsBridge />
      <CoachmarkTour />
    </div>
  );
}
