import { describe, it, expect } from "vitest";

import { SETTINGS_BRANCH_KEYS, SETUP_SECTION_KEYS } from "../setup-deeplink";
import { SETTINGS_BRANCH_META, SETUP_SECTION_META } from "../setup-headers";

describe("SETTINGS_BRANCH_META (PRD v3 §4.6)", () => {
  it("covers every branch key from SETTINGS_BRANCH_KEYS", () => {
    // The branch meta map must stay in lockstep with the canonical
    // branch key list. A missing entry crashes the page header on
    // that branch.
    for (const key of SETTINGS_BRANCH_KEYS) {
      expect(SETTINGS_BRANCH_META[key]).toBeDefined();
    }
  });

  it("provides a non-empty title and description for every branch", () => {
    // A blank header would render an empty H1 above the form —
    // visually broken and a screen-reader trap. Non-empty strings
    // are the minimum bar.
    for (const key of SETTINGS_BRANCH_KEYS) {
      const meta = SETTINGS_BRANCH_META[key];
      expect(meta.title.trim().length, `title for "${key}"`).toBeGreaterThan(0);
      expect(
        meta.description.trim().length,
        `description for "${key}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the editorial entry-point copy on the Profile (default) branch", () => {
    // Profile is the landing branch when no `?branch=` is set. The
    // entry-point hero copy ("Your studio, dialed in.") survives
    // from the 7-tab era because it's the producer's first
    // impression of the Settings surface.
    expect(SETTINGS_BRANCH_META.profile.title).toMatch(/dialed in/i);
  });

  it("uses 'connected' in the Integrations branch description", () => {
    // PRD v3 §4.6 frames Integrations as "tools, connected" — the
    // copy should reinforce that this branch is about external
    // systems Skitza coordinates with.
    expect(SETTINGS_BRANCH_META.integrations.title).toMatch(/connected/i);
  });
});

describe("SETUP_SECTION_META (legacy 7-tab back-compat)", () => {
  it("still covers every legacy section key", () => {
    // The legacy meta map keeps the 7-tab era headlines available
    // for any caller (tests, older components) that hadn't migrated
    // to the branch-keyed map yet. Parity with SETUP_SECTION_KEYS is
    // the contract.
    for (const key of SETUP_SECTION_KEYS) {
      expect(SETUP_SECTION_META[key]).toBeDefined();
    }
  });

  it("preserves the per-section legacy copy that the 7-tab page used", () => {
    // Pre-flatten the Services and Availability tabs each rendered a
    // CrossLinkSection card with eyebrow + title + description.
    // Pinning the strings here keeps the back-compat copy faithful —
    // if someone tweaks them without intent, the test catches it.
    expect(SETUP_SECTION_META.services.title).toMatch(/sell/i);
    expect(SETUP_SECTION_META.availability.title).toMatch(/open/i);
  });
});
