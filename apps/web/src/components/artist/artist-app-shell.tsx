import Link from "next/link";
import type { Studio } from "~/server/artist/identity";
import { ArtistAudioProvider } from "./artist-audio-context";
import { BottomNav } from "./bottom-nav";
import { PersistentMiniPlayer } from "./persistent-mini-player";
import { StudioSwitcher } from "./studio-switcher";

// Wraps the artist app. Header (Studio Switcher + producer link when
// applicable) + main content + persistent mini-player + bottom nav.
// The mini-player owns the singleton <audio> element via
// ArtistAudioProvider, so tab navigation never remounts it (Task 6).
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
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <StudioSwitcher studios={studios} />
          </div>
          {isProducer ? (
            <Link
              href="/dashboard"
              className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
            >
              ← Studio
            </Link>
          ) : null}
        </header>

        <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:pb-40">{children}</main>

        <PersistentMiniPlayer />

        <BottomNav />
      </div>
    </ArtistAudioProvider>
  );
}
