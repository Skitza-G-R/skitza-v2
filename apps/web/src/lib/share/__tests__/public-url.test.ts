import { describe, it, expect } from "vitest";

import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "../public-url";

// `lib/share/public-url` is the single source of truth for producer-
// facing share URLs (the `/join/<slug>` link a producer pastes into
// their IG bio, the dashboard share-chip, etc.). The pre-2026-05-06
// surfaces threaded an env-driven `publicBaseUrl` through props, which
// meant a misconfigured `NEXT_PUBLIC_SITE_URL` in Vercel produced
// share links pointing at the preview host (e.g.
// `skitza-v2-web.vercel.app/join/giliasr`). Producer share links must
// always be the canonical brand origin — these tests pin that.

describe("PUBLIC_BRAND_ORIGIN", () => {
  it("is the canonical https://skitza.app origin", () => {
    expect(PUBLIC_BRAND_ORIGIN).toBe("https://skitza.app");
  });

  it("has no trailing slash (so concatenation never double-slashes)", () => {
    expect(PUBLIC_BRAND_ORIGIN).not.toMatch(/\/$/);
  });
});

describe("buildJoinUrl", () => {
  it("builds the canonical join URL for a slug", () => {
    expect(buildJoinUrl("giliasr")).toBe("https://skitza.app/join/giliasr");
  });

  it("returns the same shape for any slug shape we accept", () => {
    expect(buildJoinUrl("alice")).toBe("https://skitza.app/join/alice");
    expect(buildJoinUrl("gili-asraf")).toBe(
      "https://skitza.app/join/gili-asraf",
    );
  });

  it("ignores process.env.NEXT_PUBLIC_SITE_URL — share URLs are brand-canonical", () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://skitza-v2-web.vercel.app";
    try {
      expect(buildJoinUrl("giliasr")).toBe(
        "https://skitza.app/join/giliasr",
      );
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = prev;
      }
    }
  });

  it("ignores process.env.SITE_URL — share URLs are brand-canonical", () => {
    const prev = process.env.SITE_URL;
    process.env.SITE_URL = "https://skitza-v2-web.vercel.app";
    try {
      expect(buildJoinUrl("giliasr")).toBe(
        "https://skitza.app/join/giliasr",
      );
    } finally {
      if (prev === undefined) {
        delete process.env.SITE_URL;
      } else {
        process.env.SITE_URL = prev;
      }
    }
  });
});
