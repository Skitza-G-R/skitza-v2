// Settings branch keys — the source of truth for `?branch=<key>` URL
// state on /dashboard/settings. PRD v3 §4.6 collapsed the prior 7-tab
// surface (profile/services/portfolio/availability/autopilot/connections/
// account) into 2 branches:
//   - "profile"      — account identity (display name, slug, currency,
//                      timezone, brand image/colors, account/data export)
//   - "integrations" — services, availability, autopilot rules, Stripe.
//
// Used by:
//   - settings-branches.tsx (renders the 2-branch chip bar)
//   - page.tsx              (parses the query param server-side and
//                            renders only the active branch)
//   - middleware.ts         (legacy `?section=<key>` and
//                            /dashboard/{portfolio,services,availability}
//                            URLs redirect into one of the 2 branches —
//                            see LEGACY_SECTION_TO_BRANCH below)
//
// SECTION → BRANCH mapping (legacy `?section=*` deep links, kept so
// bookmarked tabs from the 7-tab era still resolve):
//   profile      → profile        (same)
//   account      → profile        (account/data export lives in Profile)
//   portfolio    → profile        (PRD §4.6: "image" is account identity)
//   services     → integrations   (booking ops config)
//   availability → integrations   (booking ops config)
//   autopilot    → integrations   (automation rules)
//   connections  → integrations   (Stripe + GCal + CSV per PRD §4.6)

export const SETTINGS_BRANCH_KEYS = ["profile", "integrations"] as const;
export type SettingsBranchKey = (typeof SETTINGS_BRANCH_KEYS)[number];

export function isSettingsBranchKey(v: unknown): v is SettingsBranchKey {
  return (
    typeof v === "string" &&
    (SETTINGS_BRANCH_KEYS as readonly string[]).includes(v)
  );
}

// Legacy `?section=<key>` keys carried over from the 7-tab surface.
// The page-level redirect map narrows them to one of the 2 branches.
// We deliberately leave `Section` exported as a separate type so
// /middleware.ts can keep its same-shape STATIC_REDIRECTS table without
// having to special-case each legacy URL.
export const LEGACY_SECTION_KEYS = [
  "profile",
  "services",
  "portfolio",
  "availability",
  "autopilot",
  "connections",
  "account",
] as const;
export type LegacySectionKey = (typeof LEGACY_SECTION_KEYS)[number];

export function isLegacySectionKey(v: unknown): v is LegacySectionKey {
  return (
    typeof v === "string" &&
    (LEGACY_SECTION_KEYS as readonly string[]).includes(v)
  );
}

export const LEGACY_SECTION_TO_BRANCH: Record<LegacySectionKey, SettingsBranchKey> = {
  profile: "profile",
  account: "profile",
  portfolio: "profile",
  services: "integrations",
  availability: "integrations",
  autopilot: "integrations",
  connections: "integrations",
};

// Backwards-compat re-exports — until every caller migrates to the
// new branch-key types we keep the prior names live so the diff is
// minimal. New code should import the BRANCH variants.
export const SETUP_SECTION_KEYS = LEGACY_SECTION_KEYS;
export type SetupSectionKey = LegacySectionKey;
export const isSetupSectionKey = isLegacySectionKey;
