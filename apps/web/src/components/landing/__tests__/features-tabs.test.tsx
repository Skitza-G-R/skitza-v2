import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FEATURE_TABS,
  FeaturesTabs,
  featureTabClassName,
  featureContentClassName,
} from "../features-tabs";

// Tests for the 7-tab features carousel (S2 — landing-restore).
//
// Convention (per CLAUDE.md + autopilot-section.test.tsx): pin the data
// contract directly. The 7 tabs are stable identifiers; if a tab is
// added/removed/reordered, this test fails loudly. The tab-switching
// behaviour is exercised through pure helpers (`featureTabClassName`,
// `featureContentClassName`) so we don't need React Testing Library.

describe("FeaturesTabs — landing carousel (S2)", () => {
  it("exposes exactly 7 feature tabs", () => {
    expect(FEATURE_TABS).toHaveLength(7);
  });

  it("has the canonical 7 tab labels in source order", () => {
    expect([...FEATURE_TABS]).toEqual([
      "Storefront & Booking",
      "Payments on autopilot",
      "Files & Feedback",
      "Client history",
      "Follow-up on autopilot",
      "Lead Management",
      "Contracts & Protection",
    ]);
  });

  it("default active tab is index 0 (Storefront & Booking)", () => {
    // The pure helpers express the rule: tab[0] is active by default,
    // tabs[1..6] are inactive.
    expect(featureTabClassName(0, 0)).toBe("feature-tab active");
    expect(featureTabClassName(1, 0)).toBe("feature-tab");
    expect(featureContentClassName(0, 0)).toBe("feature-content active");
    expect(featureContentClassName(1, 0)).toBe("feature-content");
  });

  it("clicking a different tab makes it active and the previous inactive", () => {
    // Simulating activeIndex=3 (Client history) — tab 3 should be active,
    // tab 0 should drop the active class.
    expect(featureTabClassName(3, 3)).toBe("feature-tab active");
    expect(featureTabClassName(0, 3)).toBe("feature-tab");
    expect(featureContentClassName(3, 3)).toBe("feature-content active");
    expect(featureContentClassName(0, 3)).toBe("feature-content");
  });

  it("renders 7 tab buttons in initial server markup", () => {
    const html = renderToStaticMarkup(<FeaturesTabs />);
    // Each tab button has the data-index attribute matching the source.
    for (let i = 0; i < 7; i++) {
      expect(html).toContain(`data-index="${String(i)}"`);
    }
    // The initial render shows tab 0 active (matches the source HTML).
    expect(html).toContain('class="feature-tab active"');
  });
});
