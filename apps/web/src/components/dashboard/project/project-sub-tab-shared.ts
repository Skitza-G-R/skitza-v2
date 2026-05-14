// Server-safe shared types + type guard for the Project Room sub-tabs
// (Music / Sessions / Money / Notes).
//
// Why this file exists separately from `project-sub-tabs.tsx`:
// The .tsx file is a client component (`"use client"` at top) because
// it uses `usePathname` / `useSearchParams` from `next/navigation`.
// But the server page at `app/(app)/dashboard/projects/[id]/page.tsx`
// also needs the type-guard (`isProjectSubTabId`) to narrow
// `searchParams.tab` before handing it to the client component.
// React Server Components forbids calling a function defined in a
// client module from server code — doing so raised the 2026-04-23
// "Something buzzed" crash on every project page. The fix: keep the
// pure, server-safe bits here (plain module, no `"use client"`) and
// let the client .tsx re-export them for callers who already import
// from the old path.
//
// See: docs/audit-report.md Task 18 + qa/2026-04-23-* for the trace.

// PRD §3.2 (post-2026-05-06): the Project Room ships with 5 explicit
// tabs — Overview / Music / Sessions / Files / Notes. `money` is kept
// in the accepted-id set ONLY so legacy deep-links don't 404; the
// server page resolves it back to `overview` since Money's three
// metrics now live as a strip on the Overview tab.
export const PROJECT_SUB_TAB_IDS = [
  "overview",
  "music",
  "sessions",
  "files",
  "notes",
  "money",
] as const;

export type ProjectSubTabId = (typeof PROJECT_SUB_TAB_IDS)[number];

// Visible-in-the-tabstrip subset. `money` is a legacy alias only — it
// resolves to `overview` server-side and never appears as a clickable
// tab. The order here is the canonical PRD ordering.
export const VISIBLE_PROJECT_SUB_TAB_IDS = [
  "overview",
  "music",
  "sessions",
  "files",
  "notes",
] as const satisfies readonly ProjectSubTabId[];

export type VisibleProjectSubTabId = (typeof VISIBLE_PROJECT_SUB_TAB_IDS)[number];

/**
 * Narrow a raw `?tab=` value (single string / array / undefined) into
 * a known sub-tab id. Returns `false` for anything unknown so the
 * caller can fall back to the default tab.
 *
 * Safe to import from both server and client code — this module has
 * no React hooks, no `"use client"` directive, and no browser APIs.
 */
export function isProjectSubTabId(
  v: string | null | undefined,
): v is ProjectSubTabId {
  if (!v) return false;
  return (PROJECT_SUB_TAB_IDS as readonly string[]).includes(v);
}

/**
 * Resolve a raw `?tab=` value to the actual rendered tab. Maps the
 * `money` legacy alias onto `overview` (where the 3-metric money
 * strip now lives) and falls back to `overview` for anything
 * unrecognised.
 */
export function resolveProjectSubTab(
  raw: string | string[] | undefined,
): VisibleProjectSubTabId {
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (!isProjectSubTabId(single)) return "overview";
  // `money` was the standalone Money tab pre-PRD-v3; the same numbers
  // now live as a strip on Overview. Honour old deep-links by routing
  // them there silently — no redirect cost, just a render-time choice.
  if (single === "money") return "overview";
  return single;
}
