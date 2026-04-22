import { UserButton } from "@clerk/nextjs";
import type { Studio } from "~/server/artist/identity";

import { ArtistAudioProvider } from "./artist-audio-context";
import { ArtistSidebar } from "./artist-sidebar";
import { BottomNav } from "./bottom-nav";
import { PersistentMiniPlayer } from "./persistent-mini-player";
import { StudioSwitcher } from "./studio-switcher";

// Wraps the artist app. Two layouts behind one component, toggled by
// Tailwind's `md:` breakpoint:
//
//   Mobile (<md):  sticky top header (StudioSwitcher + UserButton)
//                  + main content
//                  + PersistentMiniPlayer
//                  + BottomNav (4 tabs)
//
//   Desktop (≥md): left sidebar (ArtistSidebar — studio switcher + nav
//                                 + notifications + UserButton)
//                  + main content (wider canvas)
//                  + PersistentMiniPlayer docked bottom-right
//                  (no header, no bottom nav — sidebar handles chrome)
//
// Both layouts share the same <ArtistAudioProvider> so the singleton
// <audio> element survives a viewport-resize reflow (though in practice
// that's rare — the responsive split is for different devices, not
// resizing windows).
//
// 2026-04-22 — Task 17 Phase 2 (docs/audit-report.md + design brief).
// Gili's Q1 answer: "like producer" desktop sidebar. Phase 1 already
// shipped the UserButton + UserButton.Link-to-dashboard pattern for
// dual-role users; this phase adds the full desktop shell. Phase 3
// will add `/artist/settings` accessed via the UserButton dropdown.

export function ArtistAppShell({
  isProducer,
  studios,
  children,
}: {
  isProducer: boolean;
  studios: Studio[];
  children: React.ReactNode;
}) {
  return (
    <ArtistAudioProvider>
      <div className="relative flex min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
        {/* Desktop sidebar — hidden on mobile via `hidden md:flex`
            inside the component itself. */}
        <ArtistSidebar studios={studios} isProducer={isProducer} />

        {/* Content column — fills remaining width next to the sidebar
            on desktop, takes the full viewport on mobile. */}
        <div className="flex min-h-dvh flex-1 flex-col">
          {/* Mobile-only header. `sk-safe-top` pads the notch on PWA
              standalone mode. Hidden on desktop (the sidebar replaces
              both the header and the bottom-nav). */}
          <header className="sk-safe-top sk-safe-x sticky top-0 z-30 flex items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/85 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center gap-3">
              <StudioSwitcher studios={studios} />
            </div>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
                },
              }}
            >
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Settings"
                  labelIcon={<SettingsMenuIcon />}
                  href="/artist/settings"
                />
                {isProducer ? (
                  <UserButton.Link
                    label="Producer dashboard"
                    labelIcon={<BackArrowIcon />}
                    href="/dashboard"
                  />
                ) : null}
              </UserButton.MenuItems>
            </UserButton>
          </header>

          {/* Main content — mobile reserves pb-32/sm:pb-40 for the
              bottom nav + mini-player stack; desktop only needs
              breathing room for the mini-player (md:pb-24). */}
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-6 sm:pb-40 md:max-w-3xl md:pb-24 md:pt-10">
            {children}
          </main>
        </div>

        <PersistentMiniPlayer />

        {/* Mobile-only bottom nav; the sidebar replaces it on desktop. */}
        <BottomNav />
      </div>
    </ArtistAudioProvider>
  );
}

// Same back-arrow used in the mobile UserButton menu item (also lives
// in ArtistSidebar). Kept local rather than exported because the two
// components tweak sizing independently if needed.
function BackArrowIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function SettingsMenuIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.3-1.7.6a5 5 0 0 0-1.8-1L9.3 1.5H6.7l-.2 1.7a5 5 0 0 0-1.8 1l-1.7-.6L1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.3 1.7-.6a5 5 0 0 0 1.8 1l.2 1.7h2.6l.2-1.7a5 5 0 0 0 1.8-1l1.7.6 1.3-2.3L12.9 9a5 5 0 0 0 .1-1Z" />
    </svg>
  );
}
