"use client";

// Setup tab bar — replaces the previous chip jump-bar that scrolled
// to anchored sections on a single long-scroll page. User feedback:
// "easy to miss and those are the core features of the app." This
// component is a proper tab bar keyed off `?section=<key>` so the
// server page can render one section at a time.
//
// Pattern mirrors ~/components/dashboard/project/project-sub-tabs.tsx
// so Setup and the Project Room feel like siblings. Same URL-driven
// state, same `aria-current="page"`, same CSS var palette, same
// mobile horizontal-scroll with `.sk-scroll-x`.

import Link from "next/link";

import type { SetupSectionKey } from "./setup-deeplink";

const TABS: readonly { id: SetupSectionKey; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "services", label: "Services" },
  { id: "portfolio", label: "Portfolio" },
  { id: "availability", label: "Availability" },
  { id: "connections", label: "Connections" },
  { id: "account", label: "Account" },
];

export function SetupTabs({ active }: { active: SetupSectionKey }) {
  return (
    <nav
      aria-label="Setup sections"
      role="tablist"
      // sk-scroll-x — momentum scroll on iOS; the negative-margin
      // gutter + px-4 on the inner row bleed the tab bar to the edge
      // on mobile so swiped tabs don't clip on the page padding.
      className="sk-scroll-x -mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
    >
      <div className="flex min-w-max gap-1 px-4 sm:px-0">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <Link
              key={t.id}
              href={`/dashboard/settings?section=${t.id}`}
              role="tab"
              aria-selected={isActive}
              {...(isActive ? { "aria-current": "page" as const } : {})}
              id={`setup-tab-${t.id}`}
              aria-controls={`setup-panel-${t.id}`}
              // min-h-[44px] mobile / compact on desktop — matches
              // project-sub-tabs exactly. `scroll={false}` on the
              // Link prevents Next from jumping to top when the URL
              // changes; we stay in place and the panel content
              // swaps in.
              scroll={false}
              className={[
                "-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap rounded-t-sm border-b-2 px-4 py-2.5 text-sm font-medium transition-colors sm:min-h-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                  : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
              ].join(" ")}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
