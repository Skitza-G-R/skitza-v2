import { describe, it, expect } from "vitest";

import { SETUP_SECTION_KEYS, isSetupSectionKey } from "../setup-deeplink";

describe("Setup deep-link keys", () => {
  it("exposes exactly six sections, in canonical order", () => {
    expect(SETUP_SECTION_KEYS).toEqual([
      "profile",
      "services",
      "portfolio",
      "availability",
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
