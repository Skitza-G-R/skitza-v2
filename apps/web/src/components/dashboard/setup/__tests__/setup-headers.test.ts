import { describe, it, expect } from "vitest";

import { SETUP_SECTION_KEYS } from "../setup-deeplink";
import { SETUP_SECTION_META } from "../setup-headers";

describe("SETUP_SECTION_META", () => {
  it("covers every section key from the canonical SETUP_SECTION_KEYS list", () => {
    // The map MUST stay in lockstep with SETUP_SECTION_KEYS — a missing
    // entry crashes the page header on that tab. The deeplink test
    // pins the key list itself (7 keys, canonical order); this test
    // just guarantees parity. Both halves of the contract live in
    // pure data modules so the server page can import them without
    // touching a `"use client"` boundary.
    for (const key of SETUP_SECTION_KEYS) {
      expect(SETUP_SECTION_META[key]).toBeDefined();
    }
  });

  it("provides a non-empty title and description for every section", () => {
    // A blank header would render an empty H1 above the form — visually
    // broken and a screen-reader trap (the role=heading lands on
    // nothing). Non-empty strings are the minimum bar.
    for (const key of SETUP_SECTION_KEYS) {
      const meta = SETUP_SECTION_META[key];
      expect(meta.title.trim().length, `title for "${key}"`).toBeGreaterThan(0);
      expect(
        meta.description.trim().length,
        `description for "${key}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the editorial entry-point copy on the Profile (default) tab", () => {
    // Profile is the landing tab when no `?section=` is set. Per the
    // PRD §4.4 delta, this tab keeps the original "Your studio,
    // dialed in." hero copy as the entry-point moment — switching
    // tabs is what changes the H1, not landing on the page.
    expect(SETUP_SECTION_META.profile.title).toMatch(/dialed in/i);
  });

  it("matches the per-section copy used by the legacy cross-link cards", () => {
    // Pre-flatten, the Services + Availability tabs each rendered a
    // CrossLinkSection card with eyebrow + title + description. The
    // page-level header now hosts that copy (so the form renders
    // un-prefaced below it). Pinning the strings here keeps the
    // refactor faithful — if someone tweaks the copy in this map
    // without intent, the test catches it.
    expect(SETUP_SECTION_META.services.title).toMatch(/sell/i);
    expect(SETUP_SECTION_META.availability.title).toMatch(/open/i);
  });
});
