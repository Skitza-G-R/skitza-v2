"use client";

import Link from "next/link";

import {
  CLIENT_DETAIL_TAB_KEYS,
  type ClientDetailTabKey,
} from "~/lib/dashboard/client-detail-tab-key";

// URL-driven tabs nav for the client detail page. Mirrors the sibling
// `ClientsPageTabs` (one level up the route tree) — same pill chip
// styling, same `aria-current` + `aria-controls` ID convention, same
// scroll={false} so swapping tabs doesn't bounce the viewport.
//
// Each Link points at `?tab=<key>` so:
//   • Refresh preserves the active tab.
//   • Cmd-clicking a tab opens it in a new window.
//   • Server-side rendering of the active panel is straightforward —
//     `searchParams.tab` resolves to a `ClientDetailTabKey` via the
//     pure resolver in `~/lib/dashboard/client-detail-tab-key`.
//
// Project count is an optional decorator next to the "Projects" label
// so the producer can scan their footprint without leaving the
// Overview tab. Falsy/zero values render the bare label so a 0
// doesn't look like a "(0)" badge of nothing.

const LABELS: Record<ClientDetailTabKey, string> = {
  overview: "Overview",
  projects: "Projects",
  payments: "Payments",
  notes: "Notes & files",
};

export function ClientDetailTabs({
  active,
  clientId,
  projectCount,
}: {
  active: ClientDetailTabKey;
  clientId: string;
  projectCount: number;
}) {
  return (
    <nav
      aria-label="Client detail sections"
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max gap-2">
        {CLIENT_DETAIL_TAB_KEYS.map((tab) => {
          const isActive = active === tab;
          const label = LABELS[tab];
          const showCount = tab === "projects" && projectCount > 0;
          return (
            <Link
              key={tab}
              href={`/dashboard/clients-projects/clients/${clientId}?tab=${tab}`}
              aria-current={isActive ? "page" : undefined}
              id={`client-detail-tab-${tab}`}
              aria-controls={`client-detail-panel-${tab}`}
              scroll={false}
              className={[
                "sk-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2.5 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
            >
              <span>{label}</span>
              {showCount ? (
                <span
                  className={[
                    "sk-num font-mono text-[0.66rem] tabular-nums",
                    isActive
                      ? "text-[rgb(var(--brand-primary))]"
                      : "text-[rgb(var(--fg-muted))]",
                  ].join(" ")}
                >
                  ({projectCount.toString()})
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
