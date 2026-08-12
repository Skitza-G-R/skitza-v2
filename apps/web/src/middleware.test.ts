import { describe, it, expect } from "vitest";
import {
  bypassesClerkSession,
  isAccessGated,
  isRetiredPublicPath,
  resolveLegacyRedirect,
  trustedOnboardingRequestHeaders,
} from "./middleware";

describe("Clerk session bypass", () => {
  it("bypasses Clerk only for the signed Google Calendar OAuth callback", () => {
    expect(bypassesClerkSession("/api/integrations/google-calendar/callback")).toBe(true);
    expect(bypassesClerkSession("/api/integrations/google-calendar/connect")).toBe(false);
    expect(bypassesClerkSession("/api/integrations/google-calendar/callback/extra")).toBe(false);
    expect(bypassesClerkSession("/dashboard/calendar")).toBe(false);
  });
});

// The pure `resolveLegacyRedirect` operates on pathname only; query-string
// preservation on the 301 response is handled in the `clerkMiddleware`
// callback and isn't unit-tested here (would require mocking Clerk +
// NextResponse). The behavior is covered by the manual QA in Task 15.
describe("resolveLegacyRedirect", () => {
  it.each([
    ["/dashboard/pipeline", "/dashboard"],
    ["/dashboard/clients", "/dashboard"],
    ["/dashboard/leads", "/dashboard"],
    ["/dashboard/bookings", "/dashboard"],
    ["/dashboard/contracts", "/dashboard"],
    ["/dashboard/invoices", "/dashboard"],
    ["/dashboard/inbox", "/dashboard"],
    ["/dashboard/library", "/dashboard/music"],
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

describe("retired public routes", () => {
  it.each([
    "/changelog",
    "/changelog/old",
    "/get-started",
    "/get-started/he",
    "/get-started/thanks",
  ])("keeps %s unavailable before and after public launch", (pathname) => {
    expect(isRetiredPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/about",
    "/privacy",
    "/terms",
    "/sign-in",
    "/sign-up",
    "/producer-access",
    "/join/studio",
    "/listen/token",
  ])("does not retire required public route %s", (pathname) => {
    expect(isRetiredPublicPath(pathname)).toBe(false);
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
      isOnboardingPreview: false,
    });

    expect(headers.get("x-pathname")).toBe("/onboarding/studio");
    expect(headers.get("x-onboarding-intent")).toBeNull();
    expect(headers.get("x-onboarding-preview-bypass")).toBeNull();
  });

  it("sets only the trusted preview value after create-studio intent is retired", () => {
    const requestContext = {
      incomingHeaders: new Headers(),
      pathname: "/onboarding/studio",
      isOnboardingPreview: true,
      // Keep the retired query in the regression input even though the helper
      // no longer accepts or trusts search params. If query-derived intent is
      // ever reintroduced, this test must fail.
      searchParams: new URLSearchParams("intent=create-studio"),
    };
    const headers = trustedOnboardingRequestHeaders(requestContext);

    expect(headers.get("x-onboarding-intent")).toBeNull();
    expect(headers.get("x-onboarding-preview-bypass")).toBe("1");
  });
});
