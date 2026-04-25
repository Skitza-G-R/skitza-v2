// Pure URL → ActiveKey derivation for the dashboard sidebar.
//
// Lives in a plain `.ts` module — no `"use client"` directive, no
// React imports, no browser APIs — so it stays importable from
// either a server component (e.g. for a future page-title helper) or
// the existing client Sidebar without re-introducing the cross-
// boundary crash logged in CLAUDE.md (audit Task 18, 2026-04-23).
//
// Used by Sidebar (apps/web/src/components/shell/sidebar.tsx) which
// reads `usePathname()` and feeds it through this helper. Replaces
// the old `active` prop that every dashboard page had to pass to
// <AppShell> — a per-page literal that was easy to forget on a new
// route. Now the active state is a derivation of the URL.

export type ActiveKey = "today" | "music" | "projects" | "setup";

// Order of checks matters. The longest-match-first principle keeps
// this readable without a router library: more specific prefixes
// would go first, but here every group has a single namespace under
// /dashboard so plain prefix checks are sufficient.
export function getActiveKey(pathname: string): ActiveKey {
  if (pathname === "/dashboard") return "today";
  if (pathname.startsWith("/dashboard/music")) return "music";
  if (pathname.startsWith("/dashboard/projects")) return "projects";
  if (pathname.startsWith("/dashboard/booking")) return "projects";
  if (pathname.startsWith("/dashboard/settings")) return "setup";
  if (pathname.startsWith("/dashboard/onboarding")) return "setup";
  return "today";
}
