"use client";

// Settings branch chip bar — the 2-branch surface PRD v3 §4.6 calls
// for. Mirrors the Calendar tabs (Meetings / Availability) visually
// and structurally so the producer-side toggle pattern feels uniform.
//
// URL contract: /dashboard/settings?branch=<key>. Legacy `?section=*`
// links are rewritten to `?branch=*` server-side in page.tsx, so the
// chips themselves only need to know the new key.

import Link from "next/link";

import type { SettingsBranchKey } from "./setup-deeplink";

const BRANCHES: readonly { id: SettingsBranchKey; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "integrations", label: "Integrations" },
];

export function SettingsBranches({ active }: { active: SettingsBranchKey }) {
  return (
    <nav
      aria-label="Settings branches"
      // sk-scroll-x — momentum scroll on iOS; same negative-margin
      // bleed as Calendar/Clients-Projects tabs so the chips touch
      // the page edge on mobile rather than clipping inside the
      // page padding.
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex min-w-max gap-2">
        {BRANCHES.map((branch) => {
          const isActive = active === branch.id;
          return (
            <Link
              key={branch.id}
              href={`/dashboard/settings?branch=${branch.id}`}
              aria-current={isActive ? "page" : undefined}
              id={`settings-branch-${branch.id}`}
              aria-controls={`settings-panel-${branch.id}`}
              scroll={false}
              className={[
                "sk-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors sm:min-h-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
                isActive
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
            >
              {branch.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
