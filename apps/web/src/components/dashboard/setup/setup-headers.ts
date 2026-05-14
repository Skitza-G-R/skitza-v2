// Per-branch page-level header copy for /dashboard/settings.
//
// PRD v3 §4.6 collapsed Settings from 7 tabs into 2 branches: Profile
// and Integrations. The page header swaps title + description per
// active branch — same pattern as the 7-tab era, just two entries
// instead of seven. The page hero ("Settings.") stays constant; this
// data is the per-branch subtitle below it.
//
// PURE DATA MODULE — no `"use client"` directive. The settings page
// is a server component and reads these strings during render; the
// 2026-04-23 RSC-boundary mistake (page importing a function from a
// client module) means we keep this strictly server-and-test-importable.

import type { SettingsBranchKey, LegacySectionKey } from "./setup-deeplink";

export interface SettingsBranchMeta {
  title: string;
  description: string;
}

export const SETTINGS_BRANCH_META: Record<SettingsBranchKey, SettingsBranchMeta> = {
  profile: {
    title: "Your studio, dialed in.",
    description:
      "Account identity — display name, public URL, currency, brand colors, account data. Every detail clients see when your name shows up.",
  },
  integrations: {
    title: "Your tools, connected.",
    description:
      "Services, availability, automations, and payment processing — every system Skitza coordinates on your behalf.",
  },
};

// Legacy 7-tab meta — preserved as a flat lookup so any caller that
// imported `SETUP_SECTION_META` still resolves. Internal page render
// uses SETTINGS_BRANCH_META; the legacy export only exists to keep
// any older test or unrelated component compiling during transition.
export interface SetupSectionMeta {
  title: string;
  description: string;
}

export const SETUP_SECTION_META: Record<LegacySectionKey, SetupSectionMeta> = {
  profile: SETTINGS_BRANCH_META.profile,
  services: {
    title: "What you sell.",
    description:
      "Each service is one thing clients can book — sessions, mixing, mastering, production days. Set a price, a duration, and a deposit rule.",
  },
  portfolio: {
    title: "Your tracklist.",
    description:
      "Flag the tracks that play for visitors on your join page, before they sign up. Up to three appear publicly — pick the ones that sell the vibe.",
  },
  availability: {
    title: "When you’re open.",
    description:
      "Weekly hours, buffers between sessions, and blackout dates. Clients only see slots that fit inside these windows.",
  },
  autopilot: {
    title: "What Skitza handles for you.",
    description:
      "Flip a switch and it’s automatic. Flip it back whenever you want — nothing here is locked in.",
  },
  connections: SETTINGS_BRANCH_META.integrations,
  account: {
    title: "Your account.",
    description:
      "Export your data, manage email and password, or replay the four-screen tour any time.",
  },
};
