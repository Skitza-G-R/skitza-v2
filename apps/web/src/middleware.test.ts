import { describe, it, expect } from "vitest";
import { resolveLegacyRedirect } from "./middleware";

describe("resolveLegacyRedirect", () => {
  it.each([
    ["/dashboard/pipeline",   "/dashboard"],
    ["/dashboard/clients",    "/dashboard"],
    ["/dashboard/leads",      "/dashboard"],
    ["/dashboard/bookings",   "/dashboard"],
    ["/dashboard/contracts",  "/dashboard"],
    ["/dashboard/invoices",   "/dashboard"],
    ["/dashboard/inbox",      "/dashboard"],
    ["/dashboard/library",    "/dashboard/music"],
    ["/dashboard/portfolio",  "/dashboard/settings?section=portfolio"],
    ["/dashboard/booking",    "/dashboard/settings?section=availability"],
  ])("redirects %s → %s", (from, to) => {
    expect(resolveLegacyRedirect(from)).toBe(to);
  });

  it("returns null for unknown paths", () => {
    expect(resolveLegacyRedirect("/dashboard")).toBe(null);
    expect(resolveLegacyRedirect("/dashboard/projects/abc")).toBe(null);
    expect(resolveLegacyRedirect("/random")).toBe(null);
  });

  it("preserves dynamic segments for ID-based routes", () => {
    expect(resolveLegacyRedirect("/dashboard/contracts/abc-123")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/leads/xyz")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/clients/zzz")).toBe("/dashboard");
  });
});
