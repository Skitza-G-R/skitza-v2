import Link from "next/link";
import { BottomNav } from "./bottom-nav";

// Wraps the artist app. Header (Studio Switcher slot — Task 12 +
// producer link when applicable) + main content + persistent
// mini-player slot (Task 6) + bottom nav. The mini-player <audio>
// will live in Task 6's React Context provider; for now reserve
// 64px so BottomNav doesn't sit flush against the eventual player.
export function ArtistAppShell({
  isProducer,
  children,
}: {
  isProducer: boolean;
  children: React.ReactNode;
}) {
  return (
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

      {/* Persistent mini-player slot — Task 6. Reserved space so
          BottomNav doesn't sit flush against the eventual player. */}
      <div className="fixed inset-x-0 bottom-16 z-20 h-16" id="artist-mini-player-slot" aria-hidden />

      <BottomNav />
    </div>
  );
}
