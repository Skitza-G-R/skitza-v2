"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Breadcrumb,
  type BreadcrumbCrumb,
} from "~/components/dashboard/common/breadcrumb";

import { useTopBarBreadcrumb } from "./topbar-breadcrumb-context";

// AppTopBar — the shared sticky chrome strip used by BOTH the producer
// dashboard and the artist app shell. Three slots, left → right:
//
//   1. Breadcrumb     — derived from the URL pathname (via the
//                       `sections` map prop) plus any extras pushed via
//                       TopBarBreadcrumb context by deep pages. One
//                       source of truth for in-page navigation.
//   2. Search trigger — visually a pill input, functionally a button.
//                       When `onSearchClick` is provided the button
//                       invokes it (producer side dispatches the
//                       command-palette event); when omitted the button
//                       renders identically but does nothing yet
//                       (artist side, until the artist palette ships).
//   3. Notifications  — a quiet bell with an amber dot when
//                       `unreadCount > 0`. The dropdown / drawer is a
//                       future PR; the dot is the at-a-glance signal.
//
// The shared component is dumb — it owns no data fetching. Section
// labels, search placeholder, search behavior, and unread count all
// come in as props so the same chrome can read identically on either
// side of the app while the configuration lives next to the surface
// that knows it.
//
// Sticky-position lives here (not in the parent shell) so the bar can
// use `usePathname` as a client component without forcing the whole
// shell into client-side rendering. Parent shells mount this at the
// top of <main>, above the page's content container.

interface Section {
  path: string;
  label: string;
}

// Walk up the path tree until we hit a known section. /dashboard/clients-
// projects/clients/abc-123 → { path: "/dashboard/clients-projects",
// label: "Clients & Projects" }. Unknown paths fall back to the
// caller-supplied `fallback` so the bar never renders blank.
function deriveSectionLabel(
  pathname: string,
  sections: Readonly<Record<string, string>>,
  fallback: Section,
): Section {
  const cleaned = pathname.replace(/\/+$/, "") || fallback.path;
  let cursor: string = cleaned;
  while (cursor.length > 0) {
    const hit = sections[cursor];
    if (hit !== undefined) return { path: cursor, label: hit };
    const lastSlash = cursor.lastIndexOf("/");
    if (lastSlash <= 0) break;
    cursor = cursor.slice(0, lastSlash);
  }
  return fallback;
}

export interface AppTopBarProps {
  /** Map of section path → label, e.g. `{ "/dashboard": "Overview" }`. */
  sections: Readonly<Record<string, string>>;
  /** Section to fall back to when the pathname matches nothing in `sections`. */
  fallback: Section;
  /** Placeholder text inside the search pill. */
  searchPlaceholder: string;
  /** Optional click handler for the search pill. When omitted the
   *  button still renders identically but is a no-op. */
  onSearchClick?: () => void;
  /** Unread notification count for the bell dot. */
  unreadCount?: number;
}

export function AppTopBar({
  sections,
  fallback,
  searchPlaceholder,
  onSearchClick,
  unreadCount = 0,
}: AppTopBarProps) {
  // App Router's usePathname always returns a string for client
  // components mounted inside a route — no need to coalesce.
  const pathname = usePathname();
  const section = deriveSectionLabel(pathname, sections, fallback);
  const extras = useTopBarBreadcrumb();

  // Scroll-aware separation (Emil-pass polish). At scroll-top the
  // topbar relies on backdrop-blur alone — no hard border, so the
  // chrome blends elegantly into the page header area. Once the page
  // has scrolled, we fade in a soft shadow + faint border to mark the
  // boundary. The threshold (4px) is small enough that even a slight
  // scroll lights it up; the transition is gentle (200ms ease-out) so
  // it doesn't feel like a state toggle.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 4);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Build the topbar breadcrumb. On a section root (no extras), we
  // show just the label — the in-page hero owns the rest of the
  // header. On deep pages, the section root becomes a clickable Link
  // so the user can return to the list with one click; the extras
  // (client name, project title, song title) are appended.
  const items: BreadcrumbCrumb[] =
    extras.length === 0
      ? [{ label: section.label }]
      : [{ label: section.label, href: section.path }, ...extras];

  return (
    <header
      aria-label="Page navigation"
      data-testid="dashboard-topbar"
      data-scrolled={scrolled ? "true" : "false"}
      // Explicit 60px blur via arbitrary class + ultra-low bg opacity
      // (0.1) is what gives the true iOS-Music frosted-glass effect.
      // Combined with the -mt-[40px] children wrapper in the parent
      // shell, the colored gradient now blurs through immediately at
      // scroll-top — no scrolling required to see the effect.
      //
      // WebkitBackdropFilter set inline because Tailwind v4 doesn't
      // emit the WebKit prefix automatically for arbitrary blur
      // values, and Safari requires it for backdrop-filter to render.
      className="sticky top-0 z-30 backdrop-blur-[60px] transition-[box-shadow,border-color] duration-200 ease-out"
      style={{
        background: "rgb(var(--bg-background) / 0.1)",
        WebkitBackdropFilter: "blur(60px)",
        borderBottom: scrolled
          ? "1px solid rgb(var(--border-subtle) / 0.6)"
          : "1px solid transparent",
        boxShadow: scrolled
          ? "0 1px 12px -4px rgb(17 16 9 / 0.06)"
          : "none",
      }}
    >
      <div className="flex w-full items-center gap-3 px-3 py-1 sm:gap-4 sm:px-4">
        {/* Breadcrumb (top-left). Hidden on the smallest screens
            where the search trigger needs the full row to read; the
            search pill still hints the page via context. */}
        <div
          data-testid="topbar-section-label"
          className="hidden min-w-0 flex-shrink overflow-hidden md:block"
        >
          <Breadcrumb items={items} />
        </div>

        {/* Search trigger (right, next to the bell). Renders as a pill
            input but is a button — clicking dispatches whatever the
            wrapping side wired (producer: command palette; artist: no
            handler today). */}
        <div className="ml-auto flex justify-end">
          <button
            type="button"
            onClick={onSearchClick}
            data-testid="topbar-search-trigger"
            className="inline-flex w-[260px] max-w-[420px] items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-left text-[12.5px] transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] hover:shadow-[0_1px_3px_rgb(17_16_9/0.05)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] sm:w-[320px] lg:w-[400px]"
            style={{
              background: "rgb(var(--bg-elevated))",
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-muted))",
            }}
            aria-label="Open search palette"
          >
            <Search size={13} strokeWidth={2.2} aria-hidden />
            <span className="flex-1 truncate">{searchPlaceholder}</span>
            <kbd
              className="pointer-events-none ml-auto inline-flex items-center gap-0.5 rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px]"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                background: "rgb(var(--bg-background))",
                color: "rgb(var(--fg-muted))",
              }}
              aria-hidden
            >
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Notifications bell (right). The amber dot is the
            at-a-glance signal; clicking it doesn't yet open a drawer.
            Future work replaces the static button with a dropdown. */}
        <button
          type="button"
          data-testid="topbar-bell"
          className="relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(17_16_9/0.05)] hover:text-[rgb(var(--fg-default))] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)]"
          style={{ color: "rgb(var(--fg-muted))" }}
          aria-label={
            unreadCount > 0
              ? `Notifications (${String(unreadCount)} unread)`
              : "Notifications"
          }
        >
          <Bell size={16} strokeWidth={2} />
          {unreadCount > 0 ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full ring-2 ring-[rgb(var(--bg-background))]"
              style={{ background: "rgb(var(--brand-primary))" }}
            />
          ) : null}
        </button>
      </div>
    </header>
  );
}
