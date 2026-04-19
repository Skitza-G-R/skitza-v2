"use client";

// Sub-tab navigation for the Project Room (Music / Sessions / Money /
// Notes). Each tab is a real <Link href=?tab=...> so middle-click,
// browser history, and server-side reads of `searchParams.tab` all
// work naturally. The active tab is driven by a prop (set by the
// server-rendered page) rather than client-side state so that
// re-renders don't fight the URL.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export const PROJECT_SUB_TAB_IDS = ["music", "sessions", "money", "notes"] as const;
export type ProjectSubTabId = (typeof PROJECT_SUB_TAB_IDS)[number];

const TABS: { id: ProjectSubTabId; label: string }[] = [
  { id: "music", label: "Music" },
  { id: "sessions", label: "Sessions" },
  { id: "money", label: "Money" },
  { id: "notes", label: "Notes" },
];

// Narrow a string read from searchParams to a known tab id. Invalid
// values fall back to "music" on the server side — see page.tsx.
export function isProjectSubTabId(v: string | null | undefined): v is ProjectSubTabId {
  if (!v) return false;
  return (PROJECT_SUB_TAB_IDS as readonly string[]).includes(v);
}

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
      <nav
        aria-label="Project sections"
        role="tablist"
        className="-mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
      >
        <div className="flex min-w-max gap-1 px-4 sm:px-0">
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <Link
                key={t.id}
                href={makeHref(t.id)}
                role="tab"
                aria-selected={isActive}
                {...(isActive ? { "aria-current": "page" as const } : {})}
                id={`tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                className={[
                  "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                    : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
                scroll={false}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="pt-6">{children}</div>
    </div>
  );
}
