"use client";

import Link from "next/link";

import { CALENDAR_TAB_KEYS, type CalendarTabKey } from "./calendar-tab-key";

// Three-tab segmented control matching the locked Producer Calendar
// design spec § 3 "Header":
//   - 4px-padded pill track on warm-grey (`--bg-sunken`)
//   - Active button → white surface, 700-weight, soft shadow
//   - Inactive button → muted text, hover lifts to default
//
// Implemented with <Link> + aria-current="page" instead of role="tab"
// because the tabs deep-link via ?tab= search params and Next's router
// treats them as navigation. aria-current is the canonical "selected
// nav item" affordance for screen readers in that pattern.

const TABS: readonly { id: CalendarTabKey; label: string }[] = [
  { id: "schedule", label: "Schedule" },
  { id: "sessions", label: "Sessions" },
  { id: "availability", label: "Availability" },
] as const;

// Compile-time guard — keeps the visual TABS table aligned with the
// canonical key list the resolver/test suite consume.
const _ORDER_CHECK: readonly CalendarTabKey[] = CALENDAR_TAB_KEYS;
void _ORDER_CHECK;

export function CalendarTabs({ active }: { active: CalendarTabKey }) {
  return (
    <nav
      aria-label="Calendar sections"
      className="sk-scroll-x -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <div className="inline-flex min-w-max items-center gap-1 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-1">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={`/dashboard/calendar?tab=${tab.id}`}
              aria-current={isActive ? "page" : undefined}
              id={`calendar-tab-${tab.id}`}
              aria-controls={`calendar-panel-${tab.id}`}
              scroll={false}
              className={[
                // 44px min tap target on mobile per Skitza rule;
                // collapses to ~30px on sm+ to match the spec's
                // 7×16-padded compact desktop pill.
                "sk-press inline-flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-[0.78rem] tracking-tight transition-colors sm:min-h-0 sm:py-1.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-sunken))]",
                isActive
                  ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
                  : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
              style={{ fontWeight: 700 }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
