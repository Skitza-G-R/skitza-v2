// Sticky top nav for `/join/<slug>`.
//
// SK-28: stripped to just the Skitza wordmark on the left. The slug
// pill, anchor links, and "Book a session" CTA were removed because
// they were noise on a single-screen public page — the visitor isn't
// in the app yet, has no surfaces to navigate to from here, and the
// bento's own primary CTA is always visible.
//
// SK-29: the wordmark is now the canonical app brand lockup — amber
// LogoMark "S" + lowercase `skitza.` Wordmark — matching what the
// producer/artist app sidebars use. The back-arrow that prefixed the
// old text is dropped: visitors land here from an Instagram bio link,
// not from a previous Skitza surface, so pointing them "back" to
// nothing was friction. Clicking the lockup still routes home.
//
// Motion (SK-29, gated by prefers-reduced-motion in globals.css):
//   - Nav fades in with strong ease-out (.reveal-up).
//   - LogoMark wears an ambient amber halo (.sk-mark-aura) that
//     breathes opacity on a slow 4.2 s cycle and snaps to full
//     brightness on hover.
//   - Lockup hover lifts the mark 1 px and triggers the wordmark's
//     amber-period dot bounce (.sk-brand-lockup is the parent hook).
//   - Tactile press feedback via .sk-press (scale 0.97 on :active).

import Link from "next/link";

import { LogoMark } from "~/components/brand/logo-mark";
import { Wordmark } from "~/components/nav/wordmark";

export function JoinNav() {
  return (
    <nav
      aria-label="Page navigation"
      className={[
        "reveal-up sticky top-0 z-40 border-b border-[rgb(var(--fg-primary)/0.06)]",
        "bg-[rgb(var(--bg-base)/0.82)] backdrop-blur-md",
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-6xl items-center px-4 py-2 sm:px-8 sm:py-2.5 lg:px-10">
        <Link
          href="/"
          aria-label="Skitza home"
          className="sk-brand-lockup sk-press inline-flex items-center gap-2 rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
        >
          <span className="sk-mark-aura inline-flex">
            <LogoMark size={22} />
          </span>
          <Wordmark size={14} lowercase />
        </Link>
      </div>
    </nav>
  );
}
