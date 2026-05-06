import { describe, it, expect } from "vitest";

import {
  SETTINGS_BRANCH_KEYS,
  SETUP_SECTION_KEYS,
  LEGACY_SECTION_TO_BRANCH,
  isSettingsBranchKey,
  isLegacySectionKey,
  isSetupSectionKey,
} from "../setup-deeplink";

describe("Settings branch keys (PRD v3 §4.6)", () => {
  it("exposes exactly two branches in canonical order", () => {
    // PRD v3 §4.6: "Settings has 2 branches only: Profile (account
    // identity) and Integrations". Profile is always first because
    // it's the entry-point branch (the page defaults to it when no
    // ?branch= param is set).
    expect(SETTINGS_BRANCH_KEYS).toEqual(["profile", "integrations"]);
  });

  it("rejects unknown branch keys and non-string input", () => {
    expect(isSettingsBranchKey("nope")).toBe(false);
    expect(isSettingsBranchKey("")).toBe(false);
    expect(isSettingsBranchKey(undefined)).toBe(false);
    expect(isSettingsBranchKey(null)).toBe(false);
    expect(isSettingsBranchKey(42)).toBe(false);
    // The legacy "account"/"services"/"portfolio" tabs from the
    // 7-tab era are NOT branch keys — they map TO branches via the
    // legacy redirect table.
    expect(isSettingsBranchKey("account")).toBe(false);
    expect(isSettingsBranchKey("services")).toBe(false);
  });
});

describe("Legacy 7-tab `?section=` keys (back-compat layer)", () => {
  it("preserves the canonical 7-tab list so old bookmarks still resolve", () => {
    // The 7-tab era (pre-PRD v3 §4.6) used these keys. Settings now
    // collapses them into 2 branches, but the keys themselves stay
    // recognized by the legacy redirect mapper so bookmarks like
    // /dashboard/settings?section=portfolio still land on the right
    // branch.
    expect(SETUP_SECTION_KEYS).toEqual([
      "profile",
      "services",
      "portfolio",
      "availability",
      "autopilot",
      "connections",
      "account",
    ]);
  });

  it("includes the legacy redirect targets from the middleware table", () => {
    // middleware.ts redirects /dashboard/portfolio → ?section=portfolio
    // and /dashboard/availability → ?section=availability. Both keys
    // must remain valid legacy section keys so the page can detect
    // them and rewrite to the canonical ?branch=*.
    expect(isLegacySectionKey("portfolio")).toBe(true);
    expect(isLegacySectionKey("availability")).toBe(true);
    // isSetupSectionKey is the deprecated alias kept for back-compat.
    expect(isSetupSectionKey("portfolio")).toBe(true);
  });

  it("rejects unknown keys and non-string input", () => {
    expect(isLegacySectionKey("nope")).toBe(false);
    expect(isLegacySectionKey("")).toBe(false);
    expect(isLegacySectionKey(undefined)).toBe(false);
    expect(isLegacySectionKey(null)).toBe(false);
    expect(isLegacySectionKey(42)).toBe(false);
  });

  it("maps every legacy section key to a valid branch", () => {
    // The redirect table is exhaustive — every old key resolves to
    // either profile or integrations, never undefined.
    for (const key of SETUP_SECTION_KEYS) {
      const branch = LEGACY_SECTION_TO_BRANCH[key];
      expect(SETTINGS_BRANCH_KEYS).toContain(branch);
    }
  });

  it("groups identity-facing legacy tabs into the Profile branch", () => {
    // PRD v3 §4.6 puts "name, email, currency, image, delete account"
    // into Profile. The 7-tab Profile, Account (data export), and
    // Portfolio (image picks for the join page) all resolve there.
    expect(LEGACY_SECTION_TO_BRANCH.profile).toBe("profile");
    expect(LEGACY_SECTION_TO_BRANCH.account).toBe("profile");
    expect(LEGACY_SECTION_TO_BRANCH.portfolio).toBe("profile");
  });

  it("groups operations-facing legacy tabs into the Integrations branch", () => {
    // PRD v3 §4.6 puts "Google Calendar, payment clearing system, CSV
    // import" into Integrations. Services, availability, autopilot,
    // and the existing Stripe (connections) tab all resolve there.
    expect(LEGACY_SECTION_TO_BRANCH.services).toBe("integrations");
    expect(LEGACY_SECTION_TO_BRANCH.availability).toBe("integrations");
    expect(LEGACY_SECTION_TO_BRANCH.autopilot).toBe("integrations");
    expect(LEGACY_SECTION_TO_BRANCH.connections).toBe("integrations");
  });
});
