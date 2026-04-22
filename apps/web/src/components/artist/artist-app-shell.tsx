import { UserButton } from "@clerk/nextjs";
import type { Studio } from "~/server/artist/identity";
import { ArtistAudioProvider } from "./artist-audio-context";
import { BottomNav } from "./bottom-nav";
import { PersistentMiniPlayer } from "./persistent-mini-player";
import { StudioSwitcher } from "./studio-switcher";

// Wraps the artist app. Header (Studio Switcher + UserButton) + main
// content + persistent mini-player + bottom nav. The mini-player owns
// the singleton <audio> element via ArtistAudioProvider, so tab
// navigation never remounts it (Task 6).
//
// 2026-04-22 — Task 17 Phase 1 (docs/audit-report.md + design brief).
// Replaced the naked "← Studio" link in the header with a proper
// <UserButton /> that handles sign-out + account management.
// Dual-role users (Gili himself, and any producer who's also an
// artist of another producer) still get a "Producer dashboard" menu
// item inside UserButton — but it's tucked inside the dropdown, not
// advertised in the artist chrome. This preserves the hard role wall
// Task 16 established: the artist surface looks + feels like an
// artist surface, not a producer-lite surface.
//
// Phases 2 (desktop sidebar rebuild) + 3 (/artist/settings page) are
// separate commits — see docs/plans/active/2026-04-22-artist-ui-rebuild-design.md.
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
      <div className="relative min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
        {/* `sk-safe-top` pads the notch/Dynamic Island when the artist
            app is launched as a PWA in standalone mode. The inset
            resolves to 0 in a regular browser tab so there's no visual
            change for the vast majority of visits. */}
        <header className="sk-safe-top sk-safe-x sticky top-0 z-30 flex items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <StudioSwitcher studios={studios} />
          </div>
          <UserButton
            // Global afterSignOutUrl is configured on ClerkProvider
            // in the root layout (app/layout.tsx). Not overridden here
            // so every sign-out across the app lands on the same URL
            // (marketing "/" — per Gili's Q7 answer for Task 17).
            appearance={{
              elements: {
                // Matches the producer sidebar's avatar sizing so the
                // visual weight is consistent across both apps.
                avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
              },
            }}
          >
            {isProducer ? (
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Producer dashboard"
                  labelIcon={<StudioIcon />}
                  href="/dashboard"
                />
              </UserButton.MenuItems>
            ) : null}
          </UserButton>
        </header>

        <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:pb-40">{children}</main>

        <PersistentMiniPlayer />

        <BottomNav />
      </div>
    </ArtistAudioProvider>
  );
}

// Small back-arrow icon for the "Producer dashboard" menu item in
// UserButton. 16px to match Clerk's default menu-item icon size.
// Inline SVG keeps the bundle lean — no icon-library dependency
// needs to travel with the shell.
function StudioIcon() {
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
      {/* Left-pointing arrow — reads as "back to studio" */}
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}
