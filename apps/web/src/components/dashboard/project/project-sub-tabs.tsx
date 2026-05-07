"use client";

// Sub-tab navigation for the Project Room (Music / Sessions / Money /
// Notes). Each tab is a real <Link href=?tab=...> so middle-click,
// browser history, and server-side reads of `searchParams.tab` all
// work naturally. The active tab is driven by a prop (set by the
// server-rendered page) rather than client-side state so that
// re-renders don't fight the URL.
//
// 2026-04-23: the pure type-guard + shared types moved to
// `./project-sub-tab-shared.ts` so the server page can import them
// without crossing the RSC boundary. We re-export them here for
// callers who already import from this module.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
  type ProjectSubTabId,
} from "./project-sub-tab-shared";

// Re-export for backward compatibility with existing import paths.
export {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
  type ProjectSubTabId,
};

// Each tab carries a label and a tiny inline-SVG icon. SVGs (rather
// than emoji or icon-font) keep us dependency-free and currentColor
// reactive — the icon recolors with the active/inactive text class
// without a separate stylesheet rule.
type IconProps = { className?: string };

const SVG_BASE = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function IconLayoutGrid({ className }: IconProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function IconMusic({ className }: IconProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function IconCalendar({ className }: IconProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconDollar({ className }: IconProps) {
  return (
    <svg {...SVG_BASE} className={className}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

// label = visible name; id = URL slug. The rename per 2026-05 is
// label-only — id "music" stays put so bookmarked URLs keep working.
const TABS: {
  id: ProjectSubTabId;
  label: string;
  Icon: (props: IconProps) => ReactNode;
}[] = [
  { id: "overview", label: "Overview", Icon: IconLayoutGrid },
  { id: "music", label: "Songs", Icon: IconMusic },
  { id: "sessions", label: "Sessions", Icon: IconCalendar },
  { id: "money", label: "Payments", Icon: IconDollar },
];

export function ProjectSubTabs({
  activeTab,
  children,
}: {
  activeTab: ProjectSubTabId;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  const makeHref = (tab: ProjectSubTabId): string => {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", tab);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div>
      {/* Pill-segmented strip, lifted from the HTML reference design.
          Outer container = elevated background + subtle border + small
          inner padding so each tab sits inside a "track". The active
          tab gets the lighter base background plus a soft shadow,
          inactive tabs are flat-transparent and pick up brand color
          on hover via the inner-tab classes below. The strip is a
          horizontally-scrollable track on narrow viewports. */}
      <nav
        aria-label="Project sections"
        role="tablist"
        className="sk-scroll-x mb-4 overflow-x-auto"
      >
        <div className="inline-flex min-w-max gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1">
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            const { Icon } = t;
            return (
              <Link
                key={t.id}
                href={makeHref(t.id)}
                role="tab"
                aria-selected={isActive}
                {...(isActive ? { "aria-current": "page" as const } : {})}
                id={`tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                // min-h-[44px] hits the touch target on mobile; on
                // desktop the natural py-2 collapses to ~36px so the
                // strip stays compact. rounded-[var(--radius-sm)] for
                // the active background, plus a soft shadow that lifts
                // the active tab off the track.
                className={[
                  "inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-semibold transition-colors sm:min-h-0",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                  isActive
                    ? "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] shadow-[var(--shadow-sm)]"
                    : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
                scroll={false}
              >
                <Icon className="shrink-0" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {/* Keying the panel on activeTab forces React to remount when
          the tab changes, which replays the `reveal-up` animation so
          the new content slides + fades in instead of hard-cutting.
          The animation itself respects prefers-reduced-motion via
          globals.css's @media block. */}
      <div key={activeTab} className="reveal-up">
        {children}
      </div>
    </div>
  );
}
