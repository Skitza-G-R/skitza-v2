"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";

// DashboardTopBar — the sticky chrome strip the HTML mockup carries at
// the top of every dashboard page. Three slots, left → right:
//
//   1. Section label  — derived from the URL pathname so every page
//                       gets it for free; no per-page wiring.
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

// Walk up the path tree until we hit a known section. /dashboard/clients-
// projects/clients/abc-123 → "Clients & Projects". Unknown paths fall
// back to a generic label so the bar never renders blank.
function deriveSectionLabel(pathname: string): string {
  const cleaned = pathname.replace(/\/+$/, "") || "/dashboard";
  let cursor: string = cleaned;
  while (cursor.length > 0) {
    const hit = SECTION_LABELS[cursor];
    if (hit !== undefined) return hit;
    const lastSlash = cursor.lastIndexOf("/");
    if (lastSlash <= 0) break;
    cursor = cursor.slice(0, lastSlash);
  }
  return "Dashboard";
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
  const label = deriveSectionLabel(pathname);

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
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{
        background: "rgb(var(--bg-background) / 0.82)",
        borderBottomColor: "rgb(var(--border-subtle))",
      }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 lg:px-8">
        {/* Section label (top-left). Hidden on the smallest screens
            where the search trigger needs the full row to read; the
            search pill still hints the page via context. */}
        <h2
          className="hidden flex-shrink-0 text-[13px] font-semibold tracking-tight md:block"
          style={{ color: "rgb(var(--fg-default))" }}
          data-testid="topbar-section-label"
        >
          {label}
        </h2>

        {/* Search trigger (center). Renders as a pill input but is a
            button — clicking dispatches the same custom event that ⌘K
            does. Press feedback via active:scale, custom ease-out
            curve on hover state changes. */}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={openPalette}
            data-testid="topbar-search-trigger"
            className="inline-flex w-full max-w-[420px] items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-left text-[12.5px] transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[rgb(var(--border-strong))] hover:shadow-[0_1px_3px_rgb(17_16_9/0.05)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.5)]"
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
