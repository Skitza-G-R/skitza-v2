// Server-safe shared types + type guard for the Project Room sub-tabs
// (Dashboard / Music / Sessions / Money).
//
// Why this file exists separately from `project-sub-tabs.tsx`:
// The .tsx file is a client component (`"use client"` at top) because
// it uses `useRouter` / `useSearchParams` from `next/navigation`.
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
//
// Story 03 of the Project Room redesign (PRD §4.2 + §11.5) flipped
// the union from 'music' | 'sessions' | 'money' | 'notes' to
// 'dashboard' | 'music' | 'sessions' | 'money'. The Notes tab was
// retired; Dashboard takes its slot AND becomes the default sub-tab.
// `resolveSubTab`'s default return changed from 'music' → 'dashboard'
// at the same time (the page-level resolver lives in page.tsx).

export const PROJECT_SUB_TAB_IDS = [
  "dashboard",
  "music",
  "sessions",
  "money",
] as const;

export type ProjectSubTabId = (typeof PROJECT_SUB_TAB_IDS)[number];

/**
 * Narrow a raw `?tab=` value (single string / array / undefined) into
 * a known sub-tab id. Returns `false` for anything unknown so the
 * caller can fall back to the default tab ("dashboard" as of Story 03).
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
 * Resolve a raw `?tab=` value (which may be a string, an array of
 * strings, or undefined) into a valid ProjectSubTabId. Anything
 * unrecognised falls back to "dashboard" — the new default sub-tab as
 * of Story 03 (PRD §4.2). Lives here (not in page.tsx) so the client
 * tab strip can use the same fallback behaviour without cross-module
 * inlining.
 */
export function resolveSubTab(
  raw: string | string[] | null | undefined,
): ProjectSubTabId {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return isProjectSubTabId(first) ? first : "dashboard";
}
