// Setup section keys — the source of truth for `?section=<key>` URL
// state on /dashboard/settings. Used by:
//   - setup-tabs.tsx      (renders the tab bar)
//   - page.tsx            (parses the query param server-side and
//                          renders only the active section)
//   - middleware.ts       (redirects /dashboard/portfolio →
//                          /dashboard/settings?section=portfolio —
//                          the legacy bookmark still lands on
//                          Portfolio, now as the active tab)
//
// Pre-Batch-A this module also shipped a client-side scroll-focus
// effect that pulsed an anchored section into view. That effect was
// retired when Setup moved from one long scroll page to tab-scoped
// rendering: only the active section mounts at a time, so there's
// nothing to scroll to. The `data-setup-section` / `data-setup-focused`
// pair was removed with it.

export const SETUP_SECTION_KEYS = [
  "profile",
  "services",
  "portfolio",
  "availability",
  "connections",
  "account",
] as const;
export type SetupSectionKey = (typeof SETUP_SECTION_KEYS)[number];

export function isSetupSectionKey(v: unknown): v is SetupSectionKey {
  return typeof v === "string"
    && (SETUP_SECTION_KEYS as readonly string[]).includes(v);
}
