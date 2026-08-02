import { describe, it, expect } from "vitest";
import {
  isAccessGated,
  resolveLegacyRedirect,
  trustedOnboardingRequestHeaders,
} from "./middleware";

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
  ])("redirects %s → %s", (from, to) => {
    expect(resolveLegacyRedirect(from)).toBe(to);
  });

  it("does NOT redirect /dashboard/portfolio (live route as of PR #142)", () => {
    // Pre-PR #142 this redirected into settings?section=portfolio.
    // Portfolio is now a real page in the sidebar, so the middleware
    // must let the request pass through.
    expect(resolveLegacyRedirect("/dashboard/portfolio")).toBe(null);
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

describe("pre-launch access gate", () => {
  it.each(["/listen", "/listen/live-song-token", "/launch"])(
    "keeps intentionally public no-data routes reachable: %s",
    (pathname) => {
      expect(isAccessGated(pathname)).toBe(false);
    },
  );

  it("does not broaden the exemption to lookalike or authenticated paths", () => {
    expect(isAccessGated("/listener/live-song-token")).toBe(true);
    expect(isAccessGated("/listen-private/live-song-token")).toBe(true);
    expect(isAccessGated("/launch/resolve")).toBe(true);
    expect(isAccessGated("/dashboard/music/song-id")).toBe(true);
  });
});

describe("trusted onboarding request headers", () => {
  it("removes forged intent and preview headers when the URL is not authorized", () => {
    const headers = trustedOnboardingRequestHeaders({
      incomingHeaders: new Headers({
        "x-pathname": "/forged",
        "x-onboarding-intent": "create-studio",
        "x-onboarding-preview-bypass": "1",
      }),
      pathname: "/onboarding/studio",
      searchParams: new URLSearchParams(),
      isOnboardingPreview: false,
    });

    expect(headers.get("x-pathname")).toBe("/onboarding/studio");
    expect(headers.get("x-onboarding-intent")).toBeNull();
    expect(headers.get("x-onboarding-preview-bypass")).toBeNull();
  });

  it("sets trusted values only from the server-derived route conditions", () => {
    const headers = trustedOnboardingRequestHeaders({
      incomingHeaders: new Headers(),
      pathname: "/onboarding/studio",
      searchParams: new URLSearchParams("intent=create-studio"),
      isOnboardingPreview: true,
    });

    expect(headers.get("x-onboarding-intent")).toBe("create-studio");
    expect(headers.get("x-onboarding-preview-bypass")).toBe("1");
  });
});
