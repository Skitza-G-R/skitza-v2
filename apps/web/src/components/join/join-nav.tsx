// Sticky top nav for `/join/<slug>`.
//
// Anatomy (per design context 2026): wordmark "Skitza." + "/p/<slug>"
// mono pill on the left, anchor links + dark "Book a session" CTA on
// the right. Backdrop-blurs the page below, so the cream + amber
// gradient drift in the hero shimmers through as the visitor scrolls.
//
// Mobile: anchor links collapse to keep the bar single-row; the CTA
// stays so the conversion target is always one tap away.
//
// Server component — purely static. Anchor links use plain hash
// fragments so no JS is required.
//
// Note: the slug is shown as `/p/<slug>` in the mono pill purely as a
// visual cue — the live URL is `/join/<slug>` (not `/p/`). This matches
// the design language where artists recognise the producer's "page"
// identifier independent of routing.
//
// 2026-05-06 — booking-gate Layer 1: the "Book a session" pill links
// straight to /sign-up/join/<slug>. The inline modal flow was removed
// because it created `pending` bookings without ever forcing sign-up.

import Link from "next/link";

interface JoinNavProps {
  slug: string;
}

export function JoinNav({ slug }: JoinNavProps) {
  return (
    <nav
      aria-label="Page navigation"
      className={[
        "sticky top-0 z-40 border-b border-[rgb(var(--border-subtle))]",
        "bg-[rgb(var(--bg-base)/0.85)] backdrop-blur-md",
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-10">
        {/* Wordmark + slug pill */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline"
          >
            <span aria-hidden>← </span>Skitza.
          </Link>
          <span aria-hidden className="text-[rgb(var(--fg-muted))]/40">
            /
          </span>
          <span
            className="truncate font-mono text-[0.7rem] font-bold tracking-tight text-[rgb(var(--fg-primary))]"
            title={`/p/${slug}`}
          >
            p/{slug}
          </span>
        </div>

        {/* Right side: anchor links (≥sm) + CTA */}
        <div className="flex items-center gap-3 sm:gap-4">
          <a
            href="#work"
            className="hidden text-xs font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline sm:inline"
          >
            Work
          </a>
          <a
            href="#services"
            className="hidden text-xs font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline sm:inline"
          >
            Services
          </a>
          <a
            href="#contact"
            className="hidden text-xs font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline sm:inline"
          >
            Contact
          </a>
          <Link
            href={`/sign-up/join/${encodeURIComponent(slug)}`}
            className={[
              "sk-pop inline-flex min-h-9 items-center whitespace-nowrap",
              "rounded-[var(--radius-md)] bg-[rgb(var(--fg-primary))] px-3.5 py-2",
              "text-[0.72rem] font-bold text-[rgb(var(--bg-base))]",
              "transition-transform hover:-translate-y-[1px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-base))]",
            ].join(" ")}
          >
            Book a session
          </Link>
        </div>
      </div>
    </nav>
  );
}
