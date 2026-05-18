"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Breadcrumb,
  type BreadcrumbCrumb,
} from "~/components/dashboard/common/breadcrumb";

import { useTopBarBreadcrumb } from "./topbar-breadcrumb-context";

// DashboardTopBar — the sticky chrome strip the HTML mockup carries at
// the top of every dashboard page. Three slots, left → right:
//
//   1. Breadcrumb     — derived from the URL pathname (section root)
//                       plus any extras pushed via TopBarBreadcrumb
//                       context by deep pages. One source of truth for
//                       in-page navigation — the in-page Breadcrumb
//                       component is no longer rendered separately.
//   2. Search trigger — visually a pill input, functionally a button
//                       that opens the existing command palette via
//                       the `skitza:open-palette` custom event (the
//                       same event ⌘K already dispatches). Keeps a
//                       single source of truth for search behavior.
//   3. Notifications  — a quiet bell with an amber dot when there are
//                       unread items. The dropdown / drawer is a
//                       future PR (G6 follow-up); the dot is the
//                       at-a-glance signal for now.
//
// Sticky-position lives here (not in AppShell) so the bar can use
// `usePathname` as a client component without forcing the whole shell
// into client-side rendering. AppShell mounts it at the top of
// <main>, above the page's max-w content container.
//
// Token discipline: --bg-background as a translucent backdrop with
// `backdrop-blur-md` gives the premium "frosted glass on cream paper"
// effect without inventing new tokens. Borders use --border-subtle to
// stay legible against the warm page background.

const SECTION_LABELS: Readonly<Record<string, string>> = {
  "/dashboard": "Overview",
  "/dashboard/clients-projects": "Clients & Projects",
  "/dashboard/music": "Music",
  "/dashboard/calendar": "Calendar",
  "/dashboard/profile": "Storefront",
  "/dashboard/store": "Store",
  "/dashboard/settings": "Settings",
};

interface Section {
  path: string;
  label: string;
}

// Walk up the path tree until we hit a known section. /dashboard/clients-
// projects/clients/abc-123 → { path: "/dashboard/clients-projects",
// label: "Clients & Projects" }. Unknown paths fall back to a generic
// "Dashboard" so the bar never renders blank.
function deriveSectionLabel(pathname: string): Section {
  const cleaned = pathname.replace(/\/+$/, "") || "/dashboard";
  let cursor: string = cleaned;
  while (cursor.length > 0) {
    const hit = SECTION_LABELS[cursor];
    if (hit !== undefined) return { path: cursor, label: hit };
    const lastSlash = cursor.lastIndexOf("/");
    if (lastSlash <= 0) break;
    cursor = cursor.slice(0, lastSlash);
  }
  return { path: "/dashboard", label: "Dashboard" };
}

interface DashboardTopBarProps {
  /** Unread notification count for the bell dot. */
  unreadCount?: number;
}

export function DashboardTopBar({ unreadCount = 0 }: DashboardTopBarProps) {
  // App Router's usePathname always returns a string for client
  // components mounted inside a route — no need to coalesce. (The
  // `?? "/dashboard"` fallback would be dead code and trips
  // @typescript-eslint/no-unnecessary-condition.)
  const pathname = usePathname();
  const section = deriveSectionLabel(pathname);
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

  // The existing CommandPaletteTrigger listens for this event. Reusing
  // it keeps the keyboard shortcut, the search trigger, and any future
  // entry points in lockstep — one search surface, one open mechanism.
  const openPalette = () => {
    window.dispatchEvent(new CustomEvent("skitza:open-palette"));
  };

  return (
    <header
      aria-label="Page navigation"
      data-testid="dashboard-topbar"
      data-scrolled={scrolled ? "true" : "false"}
      className="sticky top-0 z-30 backdrop-blur-md transition-[box-shadow,border-color] duration-200 ease-out"
      style={{
        background: "rgb(var(--bg-background) / 0.82)",
        // Border + shadow fade in once the page has scrolled past 4px.
        // At scroll-top the topbar floats with no hard line; the blur
        // does the separation work.
        borderBottom: scrolled
          ? "1px solid rgb(var(--border-subtle) / 0.6)"
          : "1px solid transparent",
        boxShadow: scrolled
          ? "0 1px 12px -4px rgb(17 16 9 / 0.06)"
          : "none",
      }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 lg:px-8">
        {/* Breadcrumb (top-left). Hidden on the smallest screens
            where the search trigger needs the full row to read; the
            search pill still hints the page via context. `min-w-0` +
            `overflow-hidden` lets long crumb labels truncate via the
            Breadcrumb's per-item max-widths instead of pushing the
            search trigger off-screen or wrapping (which would break
            the topbar's fixed py-2.5 height). */}
        <div
          data-testid="topbar-section-label"
          className="hidden min-w-0 flex-shrink overflow-hidden md:block"
        >
          <Breadcrumb items={items} />
        </div>

        {/* Search trigger (right, next to the bell). `ml-auto` pushes
            the search + bell to the far right of the topbar, leaving
            air between the breadcrumb on the left and the search on
            the right. Renders as a pill input but is a button —
            clicking dispatches the same custom event that ⌘K does.
            Press feedback via active:scale, custom ease-out curve on
            hover state changes. */}
        <div className="ml-auto flex justify-end">
          <button
            type="button"
            onClick={openPalette}
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
            <span className="flex-1 truncate">
              Search projects, clients, songs…
            </span>
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

        {/* Notifications bell (right). The amber dot is the at-a-glance
            signal for now; clicking it doesn't yet open a drawer — the
            inbox lives in the sidebar's unread list. Future work
            replaces the static button with a dropdown. */}
        <button
          type="button"
          data-testid="topbar-bell"
          className="relative inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(17_16_9/0.05)] hover:text-[rgb(var(--fg-default))] active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)]"
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
