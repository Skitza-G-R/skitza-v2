"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";

import { NAV_ITEMS } from "./sidebar";

// Producer mobile bottom nav — native app-feel counterpart to the
// artist app's BottomNav (see ~/components/artist/bottom-nav.tsx).
// Same 4-tab grid, same CSS vars, same iOS safe-area plumbing, plus
// a centre "+" FAB that jumps the producer into QuickActions on
// /dashboard. Desktop keeps the left rail; this component is gated
// `md:hidden` at the call site (AppShell).
//
// FAB contract: QuickActions is a page-level section on the Today
// cockpit (not a global modal) — tapping + navigates to /dashboard
// and hash-anchors to the QuickActions strip so the producer lands
// on the 8 time-saving actions they'd expect a "+" to open. Cheaper
// than lifting QuickActions into a portal-rendered modal, and the
// visual payoff (new screen, focused list) beats an in-place popover
// for a 375px viewport.

// Look up a NAV_ITEMS entry by id. Returns null if the id isn't
// present (shouldn't happen given the readonly-tuple source of truth,
// but this keeps the tab rendering non-null-safe without violating
// `@typescript-eslint/no-non-null-assertion`).
function itemById(id: ActiveKey): (typeof NAV_ITEMS)[number] | null {
  return NAV_ITEMS.find((i) => i.id === id) ?? null;
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const active = getActiveKey(pathname);

  // Ordered slots around the centre FAB. Today + Projects flank the
  // left; Music + Setup flank the right. Matches the visual weight
  // on iOS tab bars (primary on the outer edges, frequent-creation
  // action in the middle).
  const leftTabs: ActiveKey[] = ["today", "projects"];
  const rightTabs: ActiveKey[] = ["music", "setup"];

  return (
    <nav
      role="navigation"
      aria-label="Producer tabs"
      // Fixed bottom bar, 56px tab row + iOS home-indicator inset.
      // z-30 sits above the main content but below modals (z-50+)
      // and the command palette overlay.
      className="sk-safe-bottom sk-safe-x fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/95 backdrop-blur md:hidden"
    >
      <ul className="relative mx-auto grid max-w-2xl grid-cols-5 items-end">
        {leftTabs.map((key) => {
          const item = itemById(key);
          if (!item) return null;
          return <TabItem key={item.id} item={item} active={active === key} />;
        })}

        {/* Centre slot: FAB. Wrapped in a <li> so the grid keeps the
            5-column rhythm; the FAB itself floats above the bar so
            it visually "rises" out of the nav. aria-label makes the
            + meaningful to screen readers. */}
        <li className="relative flex items-center justify-center">
          <Link
            href="/dashboard#quick-actions"
            aria-label="Quick actions"
            className="absolute -top-6 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-lg)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
          >
            <svg
              aria-hidden
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
            >
              <path d="M11 4v14M4 11h14" />
            </svg>
          </Link>
        </li>

        {rightTabs.map((key) => {
          const item = itemById(key);
          if (!item) return null;
          return <TabItem key={item.id} item={item} active={active === key} />;
        })}
      </ul>
    </nav>
  );
}

function TabItem({
  item,
  active,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={item.href}
        {...(active ? { "aria-current": "page" as const } : {})}
        // min-h-[56px] exceeds Apple's 44×44 tap-target minimum and
        // matches the artist app's bottom-nav visual weight.
        // focus-visible ring is inset so it doesn't clip the nav's
        // top border.
        className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[0.66rem] font-mono uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] ${
          active
            ? "text-[rgb(var(--brand-primary))]"
            : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-secondary))]"
        }`}
      >
        <span aria-hidden className="flex h-4 w-4 items-center justify-center">
          {item.icon}
        </span>
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
