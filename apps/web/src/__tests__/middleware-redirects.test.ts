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

  // 2026-05-06 — Services CRUD moved out of Settings/Integrations
  // into the Storefront page (PRD v3 §4.5: products live with the
  // public storefront), and Availability moved into Calendar
  // (PRD v3 §4.4: Availability is a Calendar tab). Legacy bookmarks
  // to /dashboard/services + /dashboard/availability now 301 to the
  // new homes so old links never break. The prior assertions
  // (settings?section=services / settings?section=availability) are
  // intentionally inverted — landing back on Settings would re-create
  // the bug this refactor fixes.
  it("redirects /dashboard/services to the Storefront's Store tab", () => {
    expect(resolveLegacyRedirect("/dashboard/services")).toBe(
      "/dashboard/profile?tab=store",
    );
  });

  it("redirects /dashboard/availability to the Calendar's Availability tab", () => {
    expect(resolveLegacyRedirect("/dashboard/availability")).toBe(
      "/dashboard/calendar?tab=availability",
    );
  });

  // Sanity — non-legacy paths stay null so the middleware lets them
  // through to normal routing. If the table ever started swallowing
  // /dashboard itself, every page on the app would 301 to itself.
  it("returns null for live (non-legacy) paths", () => {
    expect(resolveLegacyRedirect("/dashboard")).toBeNull();
    expect(resolveLegacyRedirect("/dashboard/settings")).toBeNull();
    expect(resolveLegacyRedirect("/dashboard/clients-projects/abc")).toBeNull();
  });
});
