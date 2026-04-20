"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { SkitzaMark } from "~/components/brand/skitza-mark";

// Landing top nav. Sticky on scroll with backdrop blur — transparent at
// the very top so the hero's ambient blobs breathe, then opaque with a
// frosted border once the user scrolls. Mobile collapses to a sheet
// using a zero-JS `<details>` (no Radix dep needed for this one case).
//
// Anchor targets live on the page (`#features`, `#pricing`, `#download`)
// while `/changelog` is a dedicated route so the nav's "Changelog" link
// lands somewhere the user can hit directly.
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={[
        "sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-200",
        scrolled
          ? "border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.78)] backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3 sm:py-4">
        <Link href="/" className="flex items-center gap-2.5 group">
          <SkitzaMark size="sm" />
          <span
            className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))] transition-colors group-hover:text-[rgb(var(--brand-primary))]"
            style={{ fontWeight: 800 }}
          >
            Skitza
          </span>
        </Link>

        <ul className="hidden items-center gap-7 text-sm font-medium text-[rgb(var(--fg-secondary))] md:flex">
          {NAV_LINKS.map((l) =>
            l.kind === "route" ? (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="transition-colors hover:text-[rgb(var(--fg-primary))]"
                >
                  {l.label}
                </Link>
              </li>
            ) : (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="transition-colors hover:text-[rgb(var(--fg-primary))]"
                >
                  {l.label}
                </a>
              </li>
            ),
          )}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-primary))]"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="pulse-glow inline-flex items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-4 py-2 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-[1.04] hover:-translate-y-[1px] active:translate-y-[1px]"
          >
            Sign up free
          </Link>
        </div>

        {/* Mobile: zero-JS disclosure sheet. `sk-tap` (44×44) clears
            the Apple/Google tap minimum; was 40×40 which fell one px
            short on iPad Safari in standalone PWA mode. */}
        <details className="group relative md:hidden">
          <summary
            aria-label="Open menu"
            className="sk-tap flex cursor-pointer list-none items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] [&::-webkit-details-marker]:hidden"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="group-open:hidden"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="hidden group-open:block"
            >
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </summary>
          <div className="absolute right-0 top-[calc(100%+0.5rem)] w-64 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2 shadow-[0_20px_60px_-12px_rgb(0_0_0/0.25)]">
            {/* Each menu row is min-h-11 (44px) + centred via flex so
                the hit region matches the Apple/Google tap minimum on
                small phones. Was `block py-2.5` which rendered ~40px
                — short by 4px for iOS's accessibility audit. */}
            <ul className="flex flex-col">
              {NAV_LINKS.map((l) =>
                l.kind === "route" ? (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="flex min-h-11 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ) : (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      className="flex min-h-11 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
                    >
                      {l.label}
                    </a>
                  </li>
                ),
              )}
              <li className="my-1 border-t border-[rgb(var(--border-subtle))]" aria-hidden />
              <li>
                <Link
                  href="/sign-in"
                  className="flex min-h-11 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-sunken))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <Link
                  href="/sign-up"
                  className="mt-1 flex min-h-12 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-4 py-2 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)]"
                >
                  Sign up free
                </Link>
              </li>
            </ul>
          </div>
        </details>
      </nav>
    </header>
  );
}

// `Link` with anchor fragments works with Next typedRoutes when we use
// relative route strings (`/#features` is not recognised) — so we use
// the anchor-only hrefs which the browser treats as same-page jumps.
// `kind` splits typedRoute `Link`s from raw anchor-fragment `<a>`s.
// Fragment hrefs like `#features` don't round-trip through typedRoutes
// (Next's `Route` type is the concrete route set, not anchors), so we
// render fragment links as plain anchors — same behaviour, no type
// noise.
type NavLink =
  | { kind: "route"; label: string; href: "/changelog" }
  | { kind: "anchor"; label: string; href: `#${string}` };

const NAV_LINKS: readonly NavLink[] = [
  { kind: "anchor", label: "Features", href: "#features" },
  { kind: "anchor", label: "Pricing", href: "#pricing" },
  { kind: "route", label: "Changelog", href: "/changelog" },
  { kind: "anchor", label: "Download", href: "#download" },
];
