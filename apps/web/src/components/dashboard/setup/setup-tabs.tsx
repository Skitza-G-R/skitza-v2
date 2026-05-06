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
import { useTranslations } from "next-intl";

import type { SetupSectionKey } from "./setup-deeplink";

// Tab ids line up with `setup.tabs.*` translation keys by design —
// `labelKey` is the same string as the SetupSectionKey, so we just
// look up `t(tab.id)` at render time.
const TABS: readonly { id: SetupSectionKey }[] = [
  { id: "profile" },
  { id: "services" },
  { id: "portfolio" },
  { id: "availability" },
  { id: "autopilot" },
  { id: "connections" },
  { id: "account" },
];

export function SetupTabs({ active }: { active: SetupSectionKey }) {
  const t = useTranslations("setup.tabs");
  // Phase 4 — pill-style toggle (matches ClientsPageTabs, CalendarTabs,
  // ProfileTabs). Same URL contract; aria-current carries the toggle
  // state. min-h-[44px] tap-target preserved for touch.
  return (
    <nav
      aria-label="Setup sections"
      // sk-scroll-x — momentum scroll on iOS; the negative-margin
      // gutter + px-4 on the inner row bleed the tab bar to the edge
      // on mobile so swiped tabs don't clip on the page padding.
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max gap-2">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/dashboard/settings?section=${tab.id}`}
              aria-current={isActive ? "page" : undefined}
              id={`setup-tab-${tab.id}`}
              aria-controls={`setup-panel-${tab.id}`}
              scroll={false}
              className={[
                "sk-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors sm:min-h-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
            >
              {t(tab.id)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
