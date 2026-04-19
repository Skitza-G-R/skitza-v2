import Link from "next/link";
import { ArtistAudioProvider } from "./artist-audio-context";
import { BottomNav } from "./bottom-nav";
import { PersistentMiniPlayer } from "./persistent-mini-player";

// Wraps the artist app. Header (Studio Switcher slot — Task 12 +
// producer link when applicable) + main content + persistent
// mini-player + bottom nav. The mini-player owns the singleton
// <audio> element via ArtistAudioProvider, so tab navigation never
// remounts it (Task 6).
export function ArtistAppShell({
  isProducer,
  children,
}: {
  isProducer: boolean;
  children: React.ReactNode;
}) {
  return (
    <ArtistAudioProvider>
      <div className="relative min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            {/* Studio Switcher slot — Task 12 */}
            <span className="font-display text-lg tracking-tight">Skitza</span>
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
