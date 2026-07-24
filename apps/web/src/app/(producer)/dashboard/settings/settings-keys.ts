// Settings redesign — section keys + URL routing helpers. Pure module
// (no React) so the server page and the client
// component can both import without crossing the RSC boundary.
//
// URL contract: /dashboard/settings?section=<key>. Five live keys
// matching the design's sub-nav order. Legacy `?branch=<key>` from the
// prior 2-branch era and legacy `?section=<key>` from the 7-tab era
// both map down to one of the five (or redirect out, for services/
// availability which moved to their canonical homes — Storefront and
// Calendar).

export const SETTINGS_SECTION_KEYS = ["profile", "plan", "notif", "int", "region"] as const;
export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number];

export function isSettingsSectionKey(v: unknown): v is SettingsSectionKey {
  return typeof v === "string" && (SETTINGS_SECTION_KEYS as readonly string[]).includes(v);
}

// Old `?section=<key>` keys (7-tab era) that redirect OUT of settings.
// PRD §4.5 moved Services to the Storefront's Store tab; PRD §4.4 moved
// Availability to the Calendar's Availability tab. Bookmarks from that
// era have to keep working, so we resolve them server-side before the
// section-key parse.
export const LEGACY_OUT_REDIRECTS = {
  services: "/dashboard/profile?tab=store",
  availability: "/dashboard/calendar?tab=availability",
} as const;

export type LegacyOutSectionKey = keyof typeof LEGACY_OUT_REDIRECTS;

export function isLegacyOutSectionKey(v: unknown): v is LegacyOutSectionKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEGACY_OUT_REDIRECTS, v);
}

// Old `?section=<key>` keys that map INTO one of the new five sections.
// `portfolio` / `marketing` / `account` belonged to the public-page
// editor (now relocated to a future /dashboard/public-page route);
// until that lands, they fall back to Profile so the URL still
// resolves. `autopilot` / `connections` collapse to Integrations.
export const LEGACY_IN_SECTION_TO_SECTION: Record<string, SettingsSectionKey> = {
  profile: "profile",
  account: "profile",
  portfolio: "profile",
  marketing: "profile",
  autopilot: "int",
  connections: "int",
};

// Old `?branch=<key>` keys (2-branch era) map cleanly: `profile` stays,
// `integrations` collapses to the new `int` short key.
export const LEGACY_IN_BRANCH_TO_SECTION: Record<string, SettingsSectionKey> = {
  profile: "profile",
  integrations: "int",
};

// ─── Sub-nav copy ─────────────────────────────────────────────────────
// Sub-nav rendering data. `iconKey` resolves to an SVG in the client;
// kept as a string here so the constant stays JSX-free (this module is
// imported by a server component).

export interface NavItem {
  key: SettingsSectionKey;
  label: string;
  iconKey: "user" | "bolt" | "bell" | "plug" | "globe";
}

export const SUB_NAV: readonly NavItem[] = [
  { key: "profile", label: "Profile", iconKey: "user" },
  { key: "plan", label: "Plan & billing", iconKey: "bolt" },
  { key: "notif", label: "Notifications", iconKey: "bell" },
  { key: "int", label: "Integrations", iconKey: "plug" },
  { key: "region", label: "Currency & region", iconKey: "globe" },
];
