// Pure URL → ClientDetailTabKey resolver for the four-tab navigation
// on `/dashboard/clients-projects/clients/[id]`.
//
// Lives in a plain `.ts` module — no `"use client"` directive, no
// React imports, no browser APIs — so it stays importable from both
// the server page (which reads `searchParams.tab`) and the client tabs
// nav. Same architectural pattern as `active-key.ts` next door:
// crossing the RSC boundary the wrong way crashed every project page
// in 2026-04-23 (CLAUDE.md mistake log "Something buzzed"), so pure
// modules are how we keep server↔client predicate sharing safe.
//
// Tabs match the founder's HTML mockup for the client space (Overview
// landing → Projects table → Payments ledger → Notes & files). The
// resolver accepts Next's raw `searchParams.tab` shape (`string |
// string[] | undefined`) and degrades to "overview" on anything
// unrecognised, so a hand-edited URL never surfaces an empty page.

export const CLIENT_DETAIL_TAB_KEYS = [
  "overview",
  "projects",
  "payments",
  "notes",
] as const;

export type ClientDetailTabKey = (typeof CLIENT_DETAIL_TAB_KEYS)[number];

export function isClientDetailTab(value: unknown): value is ClientDetailTabKey {
  return (
    typeof value === "string" &&
    (CLIENT_DETAIL_TAB_KEYS as readonly string[]).includes(value)
  );
}

export function resolveClientDetailTab(
  raw: string | string[] | undefined,
): ClientDetailTabKey {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return isClientDetailTab(candidate) ? candidate : "overview";
}
