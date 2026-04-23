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

export const PROJECT_SUB_TAB_IDS = [
  "music",
  "sessions",
  "money",
  "notes",
] as const;

export type ProjectSubTabId = (typeof PROJECT_SUB_TAB_IDS)[number];

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
