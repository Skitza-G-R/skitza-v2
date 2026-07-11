"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Breadcrumb, type BreadcrumbCrumb } from "~/components/dashboard/common/breadcrumb";

import { useTopBarBreadcrumb } from "./topbar-breadcrumb-context";

// AppTopBar — the shared sticky chrome strip used by BOTH the producer
// dashboard and the artist app shell. Three slots, left → right:
//
//   1. Breadcrumb     — derived from the URL pathname (via the
//                       `sections` map prop) plus any extras pushed via
//                       TopBarBreadcrumb context by deep pages. One
//                       source of truth for in-page navigation.
//   2. Search trigger — visually input-like, functionally a button.
//                       When `onSearchClick` is provided the button
//                       invokes it (producer side dispatches the
//                       command-palette event); when omitted the button
//                       renders identically but does nothing yet
//                       (artist side, until the artist palette ships).
//   3. Notifications  — producer passes its functional notification
//                       centre; artist keeps the existing passive dot.
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

export type AppTopBarVariant = "producer" | "artist";

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
  /** Explicit shell treatment. Producer uses SK-76's opaque 64px control
   *  strip; artist preserves its compact translucent SK-31 chrome. */
  variant: AppTopBarVariant;
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
  /** Optional functional notification control. Producer supplies the SK-76
   *  centre; artist omits it and retains the passive compatibility bell. */
  notificationControl?: ReactNode;
}

export function AppTopBar({
  variant,
  sections,
  fallback,
  searchPlaceholder,
  onSearchClick,
  unreadCount = 0,
  notificationControl,
}: AppTopBarProps) {
  // App Router's usePathname always returns a string for client
  // components mounted inside a route — no need to coalesce.
  const pathname = usePathname();
  const section = deriveSectionLabel(pathname, sections, fallback);
  const extras = useTopBarBreadcrumb();
  const isProducer = variant === "producer";

  // Scroll-aware separation: producer gains a soft shadow; artist restores
  // its prior translucent border + shadow transition after the same 4px.
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
      data-variant={variant}
      data-scrolled={scrolled ? "true" : "false"}
      className={
        isProducer
          ? "sticky top-0 z-40 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] transition-shadow duration-200 ease-out"
          : "sticky top-0 z-30 backdrop-blur-[60px] transition-[box-shadow,border-color] duration-200 ease-out"
      }
      style={
        isProducer
          ? {
              boxShadow: scrolled ? "0 1px 12px -4px rgb(17 16 9 / 0.06)" : "none",
            }
          : {
              background: "rgb(var(--bg-background) / 0.1)",
              WebkitBackdropFilter: "blur(60px)",
              borderBottom: scrolled
                ? "1px solid rgb(var(--border-subtle) / 0.6)"
                : "1px solid transparent",
              boxShadow: scrolled ? "0 1px 12px -4px rgb(17 16 9 / 0.06)" : "none",
            }
      }
    >
      <div
        className={
          isProducer
            ? "flex h-16 w-full items-center gap-3 px-4 sm:gap-4 sm:px-5"
            : "flex w-full items-center gap-3 px-3 py-1 sm:gap-4 sm:px-4"
        }
      >
        {/* Breadcrumb (top-left). Visible at every width — on phones
            (where the search pill is gone, see below) the section
            label is what anchors the slim chrome strip. */}
        <div data-testid="topbar-section-label" className="min-w-0 flex-shrink overflow-hidden">
          <Breadcrumb items={items} />
        </div>

        {/* Search trigger (right, next to the bell). It is a button styled
            as a compact search field — clicking dispatches whatever the
            wrapping side wired (producer: command palette; artist: no
            handler today). Desktop-only (`lg:`): on phones a ⌘K-pill
            wastes the whole strip and a hardware keyboard shortcut
            means nothing, so mobile chrome is just label + bell
            (Gili's 2026-06-11 audit, item 3). */}
        <div className="ml-auto flex justify-end">
          <button
            type="button"
            onClick={onSearchClick}
            data-testid="topbar-search-trigger"
            className={
              isProducer
                ? "hidden h-9 w-[260px] max-w-[420px] items-center gap-2 rounded-[var(--radius-md)] border pr-2 pl-3 text-left text-[12.5px] transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] hover:shadow-[0_1px_3px_rgb(17_16_9/0.05)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.985] sm:w-[320px] lg:inline-flex lg:w-[400px]"
                : "hidden w-[260px] max-w-[420px] items-center gap-2 rounded-full border py-1.5 pr-2 pl-3 text-left text-[12.5px] transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] hover:shadow-[0_1px_3px_rgb(17_16_9/0.05)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.985] sm:w-[320px] lg:inline-flex lg:w-[400px]"
            }
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

        <div data-testid="topbar-bell" className="flex-shrink-0">
          {notificationControl ?? (
            <button
              type="button"
              className={
                isProducer
                  ? "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94]"
                  : "relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(17_16_9/0.05)] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)] focus-visible:outline-none active:scale-[0.94]"
              }
              aria-label={
                unreadCount > 0 ? `Notifications (${String(unreadCount)} unread)` : "Notifications"
              }
            >
              <Bell size={isProducer ? 19 : 16} strokeWidth={2} aria-hidden />
              {unreadCount > 0 ? (
                <span
                  aria-hidden
                  className={
                    isProducer
                      ? "absolute top-2 right-2 inline-flex h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--bg-elevated))]"
                      : "absolute top-1.5 right-1.5 inline-flex h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--bg-background))]"
                  }
                />
              ) : null}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
