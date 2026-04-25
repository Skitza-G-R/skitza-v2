import { describe, it, expect } from "vitest";

import { resolveLegacyRedirect } from "../middleware";

describe("resolveLegacyRedirect — Setup tab flatten", () => {
  // The /dashboard/portfolio redirect already shipped (predates this
  // refactor). Re-asserting it here so a future "clean up the table"
  // pass doesn't accidentally drop it.
  it("keeps the existing /dashboard/portfolio redirect", () => {
    expect(resolveLegacyRedirect("/dashboard/portfolio")).toBe(
      "/dashboard/settings?section=portfolio",
    );
  });

  // New: Services + Availability got flattened into Setup sub-tabs.
  // These two URLs were never live as standalone routes, but the
  // PRD §4.4 delta promises bookmarks/email links to them keep
  // working. Adding them to STATIC_REDIRECTS makes that contract
  // testable.
  it("redirects /dashboard/services into the Services tab", () => {
    expect(resolveLegacyRedirect("/dashboard/services")).toBe(
      "/dashboard/settings?section=services",
    );
  });

  it("redirects /dashboard/availability into the Availability tab", () => {
    expect(resolveLegacyRedirect("/dashboard/availability")).toBe(
      "/dashboard/settings?section=availability",
    );
  });

  // Sanity — non-legacy paths stay null so the middleware lets them
  // through to normal routing. If the table ever started swallowing
  // /dashboard itself, every page on the app would 301 to itself.
  it("returns null for live (non-legacy) paths", () => {
    expect(resolveLegacyRedirect("/dashboard")).toBeNull();
    expect(resolveLegacyRedirect("/dashboard/settings")).toBeNull();
    expect(resolveLegacyRedirect("/dashboard/projects/abc")).toBeNull();
  });
});
