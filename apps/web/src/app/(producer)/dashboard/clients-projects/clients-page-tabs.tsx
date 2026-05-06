"use client";

import Link from "next/link";

import type { ClientsTabKey } from "./clients-tab-key";

// Phase 4 — pill-style toggle. Replaces the prior underline-tab look
// with the locked design's rounded-full chip pattern (amber tint
// when active, muted hairline border otherwise). The page.tsx
// `<div role="tabpanel" aria-labelledby="clients-tab-${active}">`
// reference still depends on the per-link `id="clients-tab-${id}"`
// pattern, so the IDs stay even though we've dropped the strict
// `role="tab"` semantic in favour of `aria-pressed` (filter-chip
// semantic). Both convey the toggled state to assistive tech and
// the latter doesn't require arrow-key keyboard navigation that we
// don't yet implement.

const TABS: readonly { id: ClientsTabKey; label: string }[] = [
  { id: "clients", label: "Clients" },
  { id: "projects", label: "Projects" },
];

export function ClientsPageTabs({ active }: { active: ClientsTabKey }) {
  return (
    <nav
      aria-label="Clients & projects sections"
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max gap-2">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/dashboard/clients-projects?tab=${tab.id}`}
              aria-current={isActive ? "page" : undefined}
              id={`clients-tab-${tab.id}`}
              aria-controls={`clients-panel-${tab.id}`}
              scroll={false}
              className={[
                "sk-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
