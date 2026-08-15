import { describe, it, expect } from "vitest";
import {
  bypassesClerkSession,
  buildSignedOutGuestSongRewrite,
  GUEST_SONG_ORIGINAL_PATH_HEADER,
  isAccessGated,
  isRetiredPublicPath,
  matchGuestSongPath,
  resolveClerkAuthorizedParties,
  resolveLegacyRedirect,
  trustedOnboardingRequestHeaders,
} from "./middleware";

describe("Clerk authorized parties", () => {
  it("allows only the public production origin in a non-Vercel production runtime", () => {
    expect(resolveClerkAuthorizedParties({ NODE_ENV: "production" })).toEqual([
      "https://skitza.app",
    ]);
  });

  it("preserves exact deployment, branch-preview, and project origins on Vercel", () => {
    expect(
      resolveClerkAuthorizedParties({
        NODE_ENV: "production",
        VERCEL_URL: "skitza-v2-web-deploy-abc-gili-asrafs-projects.vercel.app",
        VERCEL_BRANCH_URL:
          "https://skitza-v2-web-git-giasraf-sk-229-gili-asrafs-projects.vercel.app/",
        VERCEL_PROJECT_PRODUCTION_URL: "skitza-v2-web.vercel.app",
      }),
    ).toEqual([
      "https://skitza.app",
      "https://skitza-v2-web-deploy-abc-gili-asrafs-projects.vercel.app",
      "https://skitza-v2-web-git-giasraf-sk-229-gili-asrafs-projects.vercel.app",
      "https://skitza-v2-web.vercel.app",
    ]);
  });

  it("keeps local Test development working without widening deployed origins", () => {
    expect(resolveClerkAuthorizedParties({ NODE_ENV: "test" })).toEqual([
      "https://skitza.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
  });

  it("ignores malformed, insecure, and non-Vercel deployment values", () => {
    expect(
      resolveClerkAuthorizedParties({
        NODE_ENV: "production",
        VERCEL_URL: "http://preview.vercel.app",
        VERCEL_BRANCH_URL: "https://skitza.app.attacker.example",
        VERCEL_PROJECT_PRODUCTION_URL: "not a URL",
      }),
    ).toEqual(["https://skitza.app"]);
  });
});

describe("Clerk session bypass", () => {
  it("bypasses Clerk only for the signed Google Calendar OAuth callback", () => {
    expect(bypassesClerkSession("/api/integrations/google-calendar/callback")).toBe(true);
    expect(bypassesClerkSession("/api/integrations/google-calendar/connect")).toBe(false);
    expect(bypassesClerkSession("/api/integrations/google-calendar/callback/extra")).toBe(false);
    expect(bypassesClerkSession("/dashboard/calendar")).toBe(false);
  });
});

const VERSION_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("matchGuestSongPath", () => {
  it("matches only the canonical producer and artist Song URL shapes", () => {
    expect(matchGuestSongPath(`/dashboard/music/${VERSION_ID}`)).toEqual({
      versionId: VERSION_ID,
      surface: "producer",
    });
    expect(matchGuestSongPath(`/artist/music/song/${VERSION_ID}`)).toEqual({
      versionId: VERSION_ID,
      surface: "artist",
    });
  });

  it("accepts uppercase UUID hex without changing the observed id", () => {
    const uppercase = VERSION_ID.toUpperCase();
    expect(matchGuestSongPath(`/dashboard/music/${uppercase}`)).toEqual({
      versionId: uppercase,
      surface: "producer",
    });
  });

  it.each([
    "/dashboard/music",
    "/dashboard/music/not-a-uuid",
    `/dashboard/music/${VERSION_ID}/extra`,
    `/dashboard/music/project/${VERSION_ID}`,
    "/artist/music",
    `/artist/music/${VERSION_ID}`,
    "/artist/music/song/not-a-uuid",
    `/artist/music/song/${VERSION_ID}/extra`,
  ])("rejects adjacent or malformed route: %s", (pathname) => {
    expect(matchGuestSongPath(pathname)).toBeNull();
  });
});

describe("buildSignedOutGuestSongRewrite", () => {
  it.each([`/dashboard/music/${VERSION_ID}`, `/artist/music/song/${VERSION_ID}`])(
    "rewrites a signed-out %s request and preserves its query",
    (pathname) => {
      const response = buildSignedOutGuestSongRewrite({
        requestUrl: `https://skitza.app${pathname}?from=share`,
        pathname,
        incomingHeaders: new Headers({ accept: "text/html" }),
        userId: null,
      });

      expect(response).not.toBeNull();
      expect(response?.headers.get("x-middleware-rewrite")).toBe(
        `https://skitza.app/guest-song/${VERSION_ID}?from=share`,
      );
      expect(response?.headers.get(`x-middleware-request-${GUEST_SONG_ORIGINAL_PATH_HEADER}`)).toBe(
        pathname,
      );
    },
  );

  it("overwrites a forged original-path header with the observed pathname", () => {
    const pathname = `/dashboard/music/${VERSION_ID}`;
    const response = buildSignedOutGuestSongRewrite({
      requestUrl: `https://skitza.app${pathname}`,
      pathname,
      incomingHeaders: new Headers({
        [GUEST_SONG_ORIGINAL_PATH_HEADER]: "/artist/music/song/forged",
      }),
      userId: null,
    });

    expect(response?.headers.get(`x-middleware-request-${GUEST_SONG_ORIGINAL_PATH_HEADER}`)).toBe(
      pathname,
    );
  });

  it("does not rewrite signed-in or adjacent-route traffic", () => {
    const pathname = `/dashboard/music/${VERSION_ID}`;
    expect(
      buildSignedOutGuestSongRewrite({
        requestUrl: `https://skitza.app${pathname}`,
        pathname,
        incomingHeaders: new Headers(),
        userId: "user_123",
      }),
    ).toBeNull();
    expect(
      buildSignedOutGuestSongRewrite({
        requestUrl: `https://skitza.app/dashboard/music/project/${VERSION_ID}`,
        pathname: `/dashboard/music/project/${VERSION_ID}`,
        incomingHeaders: new Headers(),
        userId: null,
      }),
    ).toBeNull();
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
  it.each([
    "/listen",
    "/listen/live-song-token",
    "/launch",
    "/sign-in",
    "/sign-in/factor-one",
    "/sign-up",
    "/sign-up/verify-email-address",
    `/dashboard/music/${VERSION_ID}`,
    `/artist/music/song/${VERSION_ID}`,
  ])("keeps intentionally public no-data routes reachable: %s", (pathname) => {
    expect(isAccessGated(pathname)).toBe(false);
  });

  it("does not broaden the exemption to lookalike or authenticated paths", () => {
    expect(isAccessGated("/listener/live-song-token")).toBe(true);
    expect(isAccessGated("/listen-private/live-song-token")).toBe(true);
    expect(isAccessGated("/launch/resolve")).toBe(true);
    expect(isAccessGated("/dashboard/music/song-id")).toBe(true);
    expect(isAccessGated(`/dashboard/music/${VERSION_ID}/extra`)).toBe(true);
    expect(isAccessGated(`/artist/music/${VERSION_ID}`)).toBe(true);
    expect(isAccessGated("/signin/help")).toBe(true);
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
