import type { ReactNode } from "react";

import { PersistentPlayer } from "~/components/audio/persistent-player";
import { getShellState } from "~/server/shell-data";

import { CoachmarkTour } from "./coachmark-tour";
import { CommandPaletteTrigger } from "./command-palette-trigger";
import { DesktopMenuBridge } from "./desktop-menu-bridge";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { ShortcutsBridge } from "./shortcuts-bridge";
import { Sidebar } from "./sidebar";

// App shell used by /dashboard and its children. Hosted from the
// shared (app)/dashboard/layout.tsx so the shell instance survives
// sibling-route navigation — Sidebar, PersistentPlayer,
// NotificationBell, CoachmarkTour, MobileBottomNav, and the command
// palette no longer remount on every click between Today / Music /
// Projects / Setup. Active nav state is derived inside Sidebar from
// `usePathname()` rather than passed as a prop.
//
// Stays a server component so we can await the Clerk user + look up
// the producer slug once per render; everything interactive (sidebar
// state, command palette, keyboard shortcuts) lives in client
// islands mounted inside this layout.
//
// Slug + unread-count lookup lives in `server/shell-data` and is
// wrapped with `React.cache()`. Now that the shell sits in a layout
// rather than per-page, the call fires once per dashboard session
// (until a layout re-render) instead of on every navigation.
//
// CommandPalette is lazy-loaded via CommandPaletteTrigger so cmdk
// doesn't ship in the First Load JS of every dashboard route.

export async function AppShell({ children }: { children: ReactNode }) {
  const { slug, unreadCount, unreadItems } = await getShellState();
  // Public origin used by the SidebarShareChip to render the
  // /join/<slug> URL. Same fallback chain as the Today page hero
  // ShareLinkCard before Story 05 relocated the surface — keep it
  // here in the shell so every authenticated page renders the chip.
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";
  return (
    <div className="flex min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {/* Skip-to-content link — only visible on keyboard focus (sr-only
          by default, promoted to a real position + ring when focused).
          Drops keyboard users straight past the sidebar nav into the
          main surface. Must be the very first focusable element on the
          page for the WCAG 2.4.1 "Bypass Blocks" success criterion. */}
      <a
        href="#main-content"
        className="sr-only rounded-md bg-[rgb(var(--brand-primary))] px-3 py-2 text-sm font-medium text-[rgb(var(--fg-inverse))] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))] focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <Sidebar
        producerSlug={slug}
        publicBaseUrl={publicBaseUrl}
        unreadCount={unreadCount}
        unreadItems={unreadItems}
      />
      {/* pb-16 on mobile so the fixed bottom nav never hides content;
          md:pb-0 restores default padding on desktop where the bar
          isn't rendered. */}
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pb-16 md:pb-0">
        {children}
      </main>
      <MobileBottomNav />
      <CommandPaletteTrigger />
      <ShortcutsBridge />
      <DesktopMenuBridge />
      <PersistentPlayer />
      {/* First-run guided coachmark tour. Self-gates on a localStorage
          flag (`skitza:producer-tour-seen:v1`), so returning producers
          never see it. Replayable via the "Replay onboarding tour"
          button in Setup → Account, which dispatches a
          `skitza:replay-tour` window event. */}
      <CoachmarkTour />
    </div>
  );
}
