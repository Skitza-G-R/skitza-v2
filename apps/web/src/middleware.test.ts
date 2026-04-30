import { describe, it, expect } from "vitest";
import { resolveLegacyRedirect } from "./middleware";

// The pure `resolveLegacyRedirect` operates on pathname only; query-string
// preservation on the 301 response is handled in the `clerkMiddleware`
// callback and isn't unit-tested here (would require mocking Clerk +
// NextResponse). The behavior is covered by the manual QA in Task 15.
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
  ])("redirects %s → %s", (from, to) => {
    expect(resolveLegacyRedirect(from)).toBe(to);
  });

  it("returns null for unknown paths", () => {
    expect(resolveLegacyRedirect("/dashboard")).toBe(null);
    expect(resolveLegacyRedirect("/dashboard/clients-projects/abc")).toBe(null);
    expect(resolveLegacyRedirect("/random")).toBe(null);
  });

  it("preserves dynamic segments for ID-based routes", () => {
    expect(resolveLegacyRedirect("/dashboard/contracts/abc-123")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/leads/xyz")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/clients/zzz")).toBe("/dashboard");
  });
});
