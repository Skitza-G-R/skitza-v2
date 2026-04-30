"use client";

import Link from "next/link";

import type { ProfileTabKey } from "./profile-tab-key";

const TABS: readonly { id: ProfileTabKey; label: string }[] = [
  { id: "store", label: "Store" },
  { id: "portfolio", label: "Portfolio" },
];

export function ProfileTabs({ active }: { active: ProfileTabKey }) {
  return (
    <nav
      aria-label="Profile sections"
      role="tablist"
      className="sk-scroll-x -mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
    >
      <div className="flex min-w-max gap-1 px-4 sm:px-0">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/dashboard/profile?tab=${tab.id}`}
              role="tab"
              aria-selected={isActive}
              {...(isActive ? { "aria-current": "page" as const } : {})}
              id={`profile-tab-${tab.id}`}
              aria-controls={`profile-panel-${tab.id}`}
              scroll={false}
              className={[
                "-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap rounded-t-sm border-b-2 px-4 py-2.5 text-sm font-medium transition-colors sm:min-h-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                  : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
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
