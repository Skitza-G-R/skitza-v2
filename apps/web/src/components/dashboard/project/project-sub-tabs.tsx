"use client";

// Sub-tab navigation for the Project Room (Dashboard / Music /
// Sessions / Money). Story 03 of the Project Room redesign rewrote
// this component to fix the 5-second tab-switch latency the user
// reported. The fix stacks three changes (architecture-doc §7):
//
//   (a) Tab strip uses <button> + router.replace(href, { scroll:
//       false }) instead of <Link>. The URL update is shallow — no
//       Next.js server round-trip, no re-render of the page server
//       component.
//
//   (b) All 4 panels are mounted at all times. Inactive panels are
//       hidden via CSS (`[role="tabpanel"][data-active="false"] {
//       display: none }` lives in globals.css). The previous code's
//       per-tab React key (set to the active tab id) has been removed
//       from the panel wrapper — that key was forcing a full React
//       unmount + mount on every tab change, which (i) replayed the
//       reveal-up animation, (ii) re-fetched per-tab data, and (iii)
//       tore down audio playback / scroll position / in-progress
//       uploads.
//
//   (c) The reveal-up entrance animation runs ONCE per panel on first
//       paint, NOT on every tab change. We track this via a
//       `data-mounted` flag derived from `nextMountedFlag` (a sticky
//       false → true transition that fires once when the panel first
//       becomes active).
//
// 2026-04-23 (post-observability) note still applies: the pure type-
// guard + shared types live in `./project-sub-tab-shared.ts` so the
// server page can import them without crossing the RSC boundary. We
// re-export them here for callers who already import from this
// module.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
  resolveSubTab,
  type ProjectSubTabId,
} from "./project-sub-tab-shared";

// Re-export for backward compatibility with existing import paths.
export {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
  resolveSubTab,
  type ProjectSubTabId,
};

// ─── Tab list (Story 03 — 4 tabs, Dashboard first) ──────────────────
// Dashboard is the new default sub-tab (PRD §4.2 + §11.5). Notes was
// retired in this story; its file (sub-tabs/notes-sub-tab.tsx) is
// deleted.
export const PROJECT_SUB_TABS: { id: ProjectSubTabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "music", label: "Music" },
  { id: "sessions", label: "Sessions" },
  { id: "money", label: "Money" },
];

// Convenience map for spots that just want the label by id.
export const PROJECT_SUB_TAB_LABELS: Record<ProjectSubTabId, string> = {
  dashboard: "Dashboard",
  music: "Music",
  sessions: "Sessions",
  money: "Money",
};

// ─── Pure helpers (testable without RTL / DOM) ──────────────────────

/**
 * Build the new URL for a tab change. Mirrors the URLSearchParams
 * behaviour the browser would use, so middle-click + back/forward +
 * manual `?tab=` typing all converge.
 *
 * Story 03: callers feed this href into `router.replace(href, {
 * scroll: false })` for a SHALLOW client-side update — no Next.js
 * server round-trip, no re-render of the project page server
 * component.
 */
export function buildSubTabHref(args: {
  pathname: string;
  searchParams: URLSearchParams;
  tab: ProjectSubTabId;
}): string {
  // Clone so we don't mutate the caller's URLSearchParams handle (the
  // hook returns a stable instance React Router-style).
  const next = new URLSearchParams(args.searchParams.toString());
  next.set("tab", args.tab);
  const qs = next.toString();
  return qs.length > 0 ? `${args.pathname}?${qs}` : args.pathname;
}

/**
 * Aria props for a tab button. Per CLAUDE.md ARIA conventions:
 *   - id="tab-<key>" + aria-controls="panel-<key>" so the button and
 *     its associated panel point at each other
 *   - aria-current="page" on the active tab (NOT aria-pressed —
 *     that's for toggles)
 *   - aria-selected mirrors the active flag (tablist semantics)
 */
export function tabAriaProps(
  id: ProjectSubTabId,
  isActive: boolean,
): {
  id: string;
  "aria-controls": string;
  "aria-selected": boolean;
  "aria-current"?: "page";
} {
  const base = {
    id: `tab-${id}`,
    "aria-controls": `panel-${id}`,
    "aria-selected": isActive,
  } as const;
  return isActive ? { ...base, "aria-current": "page" as const } : base;
}

/**
 * Data + ARIA props for a tab panel. The CSS rule
 * `[role="tabpanel"][data-active="false"] { display: none }` (in
 * globals.css) reads the data attribute to hide inactive panels —
 * the panels remain MOUNTED so audio playback / scroll position /
 * in-progress uploads survive a tab switch.
 */
export function panelDataAttrs(
  id: ProjectSubTabId,
  isActive: boolean,
): {
  role: "tabpanel";
  id: string;
  "aria-labelledby": string;
  "data-active": "true" | "false";
} {
  return {
    role: "tabpanel",
    id: `panel-${id}`,
    "aria-labelledby": `tab-${id}`,
    "data-active": isActive ? "true" : "false",
  };
}

// ─── data-mounted flag (sticky false → true) ────────────────────────
// The reveal-up animation should fire once per panel — on the first
// time it becomes active — and never again. We model this as a sticky
// boolean that flips to true and stays true. The TSX component holds
// 4 of these in a Map and updates them on every render.
function nextMountedFlag(currentlyMounted: boolean, isActiveNow: boolean): boolean {
  if (currentlyMounted) return true;
  return isActiveNow;
}

// Test-only export — exposes the pure helper so the project-sub-tabs
// test can pin its sticky semantics without simulating React state.
export const __TEST_ONLY__ = { nextMountedFlag };

// ─── Component ──────────────────────────────────────────────────────

export function ProjectSubTabs({
  activeTab,
  panels,
}: {
  activeTab: ProjectSubTabId;
  // Each panel is rendered once and kept mounted for the lifetime of
  // the page. Callers pass the 4 sub-tab components keyed by tab id —
  // any tab without a panel is considered the producer's
  // responsibility (a missing panel renders an empty <div>).
  panels: Partial<Record<ProjectSubTabId, ReactNode>>;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  // ── Sticky mount flags ───────────────────────────────────────────
  // One per tab. Flips false → true the first time a tab becomes
  // active, then stays true forever. Drives `data-mounted` so the
  // reveal-up entrance animation runs ONCE per panel rather than on
  // every tab change. We use refs (not state) so updating the map
  // doesn't trigger an extra render — the data attribute on the next
  // render naturally reflects the latest value.
  const mountedRef = useRef<Record<ProjectSubTabId, boolean>>({
    dashboard: false,
    music: false,
    sessions: false,
    money: false,
  });

  const onTabClick = (next: ProjectSubTabId): void => {
    // Architecture-doc fix (a): shallow URL update via router.replace.
    // `scroll: false` keeps the page from jumping to top on every
    // switch (default Next behaviour for URL changes). The pathname
    // comes from the current URL — we read it via window.location so
    // we don't need to threaded it through every render.
    const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
    const href = buildSubTabHref({
      pathname,
      searchParams: new URLSearchParams(sp.toString()),
      tab: next,
    });
    router.replace(href, { scroll: false });
  };

  // ── Dev-only perf probe ──────────────────────────────────────────
  // Architecture-doc §7.2: warns if a tab switch's first paint takes
  // longer than 150ms. The probe is gated on NODE_ENV so production
  // bundles ship without the warning, and uses requestAnimationFrame
  // to wait for the next frame (which is when the data-active toggle
  // takes effect via CSS). The 150ms threshold is the §11.7 PRD
  // performance contract.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      const dt = performance.now() - t0;
      if (dt > 150) {
        console.warn(`[perf] tab switch ${activeTab} took ${String(Math.round(dt))}ms`);
      }
    });
  }, [activeTab]);

  // Memoise the per-tab flags for stable child render. The map is
  // recomputed every render but only the booleans we read for the
  // current activeTab will differ run-to-run.
  const mountFlags = useMemo<Record<ProjectSubTabId, boolean>>(() => {
    const cur = mountedRef.current;
    const out: Record<ProjectSubTabId, boolean> = {
      dashboard: nextMountedFlag(cur.dashboard, activeTab === "dashboard"),
      music: nextMountedFlag(cur.music, activeTab === "music"),
      sessions: nextMountedFlag(cur.sessions, activeTab === "sessions"),
      money: nextMountedFlag(cur.money, activeTab === "money"),
    };
    mountedRef.current = out;
    return out;
  }, [activeTab]);

  return (
    <div>
      <nav
        aria-label="Project sections"
        role="tablist"
        className="sk-scroll-x -mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
      >
        <div className="flex min-w-max gap-1 px-4 sm:px-0">
          {PROJECT_SUB_TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                onClick={() => {
                  onTabClick(t.id);
                }}
                {...tabAriaProps(t.id, isActive)}
                // min-h-[44px] on mobile → the existing py-2.5 (~40px)
                // on desktop keeps the tab strip compact. rounded-t-sm
                // clips the inset focus-visible ring to the tab's own
                // rectangle instead of flying across the underline.
                // text-left so the button doesn't centre-align the
                // single-word label inside the tap target.
                className={[
                  "-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap rounded-t-sm border-b-2 bg-transparent px-4 py-2.5 text-left text-sm font-medium transition-colors sm:min-h-0",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                  isActive
                    ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                    : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
      {/* All 4 panels are mounted at all times. Inactive ones get
          data-active="false" which the globals.css rule turns into
          `display: none`. The wrapper deliberately has no React key
          tied to the active tab — keying it to activeTab would force
          a full unmount + mount on every switch (the bug the
          architecture doc fixes). The reveal-up animation lives on
          each panel's first paint via the data-mounted attribute
          (sticky once activated). */}
      <div className="pt-6">
        {PROJECT_SUB_TABS.map((t) => {
          const isActive = activeTab === t.id;
          const hasMounted = mountFlags[t.id];
          return (
            <div
              key={t.id}
              {...panelDataAttrs(t.id, isActive)}
              data-mounted={hasMounted ? "true" : "false"}
              // The reveal-up animation fires once when data-mounted
              // flips to true (via the [data-mounted="true"] CSS rule
              // in globals.css that targets first-show panels). We
              // attach `reveal-up` only on the active panel's first
              // mount so subsequent tab switches don't replay it.
              className={[
                isActive && hasMounted ? "reveal-up" : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {panels[t.id] ?? null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
