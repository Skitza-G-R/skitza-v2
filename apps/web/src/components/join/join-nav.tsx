// Sticky top nav for `/join/<slug>`.
//
// SK-25: slimmer than the old nav (py-1.5 instead of py-3) so the bento
// below has the full ~836px of usable viewport on a 900px screen. The
// "Book a session" pill carries the nested-arrow micro-pattern from
// the bento's primary CTA so they read as the same control system.
//
// Anchors stay anchor-style (no JS scroll-spy) — the bento is a single
// viewport so #samples is the only target worth jumping to. Work and
// Services are reserved for the producer's deeper sub-pages (not yet
// shipped); they degrade to harmless no-op links until then.
//
// 2026-05-06 booking-gate Layer 1: the pill links straight to
// /sign-up/join/<slug>. Visitors must sign up before any booking
// surface (slot picker / product list / contact form) is shown.

import Link from "next/link";

interface JoinNavProps {
  slug: string;
}

const EASE_LINEAR = "cubic-bezier(0.32,0.72,0,1)";

export function JoinNav({ slug }: JoinNavProps) {
  return (
    <nav
      aria-label="Page navigation"
      className={[
        "sticky top-0 z-40 border-b border-[rgb(var(--fg-primary)/0.06)]",
        "bg-[rgb(var(--bg-base)/0.82)] backdrop-blur-md",
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-8 sm:py-2.5 lg:px-10">
        {/* Wordmark + slug pill */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))] transition-colors duration-300 hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline"
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

        {/* Anchors (≥sm) + nested-arrow CTA pill */}
        <div className="flex items-center gap-3 sm:gap-5">
          <a
            href="#samples"
            className="hidden text-[0.72rem] font-semibold text-[rgb(var(--fg-muted))] transition-colors duration-300 hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline sm:inline"
          >
            Work
          </a>
          <a
            href="#samples"
            className="hidden text-[0.72rem] font-semibold text-[rgb(var(--fg-muted))] transition-colors duration-300 hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline sm:inline"
          >
            Services
          </a>

          <Link
            href={`/sign-up/join/${encodeURIComponent(slug)}`}
            className="group inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-primary))] py-1 pl-3.5 pr-1 text-[0.72rem] font-bold text-[rgb(var(--bg-base))] transition-transform duration-500 hover:-translate-y-[1px] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--bg-base))]"
            style={{ transitionTimingFunction: EASE_LINEAR }}
          >
            Book a session
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--bg-base)/0.14)] transition-transform duration-500 group-hover:translate-x-0.5"
              style={{ transitionTimingFunction: EASE_LINEAR }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
                aria-hidden
              >
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
