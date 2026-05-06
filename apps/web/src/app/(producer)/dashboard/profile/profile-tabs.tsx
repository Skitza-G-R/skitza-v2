"use client";

import Link from "next/link";

import type { ProfileTabKey } from "./profile-tab-key";

// Phase 4 — pill-style toggle (matches ClientsPageTabs / CalendarTabs).

const TABS: readonly { id: ProfileTabKey; label: string }[] = [
  { id: "store", label: "Store" },
  { id: "portfolio", label: "Portfolio" },
];

export function ProfileTabs({ active }: { active: ProfileTabKey }) {
  return (
    <nav
      aria-label="Profile sections"
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max gap-2">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/dashboard/profile?tab=${tab.id}`}
              aria-current={isActive ? "page" : undefined}
              id={`profile-tab-${tab.id}`}
              aria-controls={`profile-panel-${tab.id}`}
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
