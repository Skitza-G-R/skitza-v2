import { describe, it, expect } from "vitest";

import { SETUP_SECTION_KEYS, isSetupSectionKey } from "../setup-deeplink";

describe("Setup deep-link keys", () => {
  it("exposes exactly seven sections, in canonical order", () => {
    // Batch G added the Autopilot tab between Availability and
    // Connections. Position matters: Autopilot sits AFTER the core
    // studio setup (profile/services/portfolio/availability) because
    // the producer typically configures those first; Autopilot then
    // automates routine outcomes once the studio is running.
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
    // These two must stay valid because middleware.ts redirects
    // /dashboard/portfolio → ?section=portfolio and the design plan
    // mentions ?section=availability as the landing surface for old
    // booking links. If someone drops one of these keys, legacy
    // bookmarks silently land on the top of the page — this test
    // catches that regression.
    expect(isSetupSectionKey("portfolio")).toBe(true);
    expect(isSetupSectionKey("availability")).toBe(true);
  });

  it("rejects unknown keys and non-string input", () => {
    expect(isSetupSectionKey("nope")).toBe(false);
    expect(isSetupSectionKey("")).toBe(false);
    expect(isSetupSectionKey(undefined)).toBe(false);
    expect(isSetupSectionKey(null)).toBe(false);
    expect(isSetupSectionKey(42)).toBe(false);
  });
});
