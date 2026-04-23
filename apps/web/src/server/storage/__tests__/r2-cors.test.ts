import { describe, expect, it } from "vitest";

import { buildR2CorsRules } from "../r2-cors";

// Regression tests for the 2026-04-23 "Failed to fetch" upload crash
// (audit Task 19). The R2 bucket `skitza-audio` had no CORS policy,
// so every browser PUT to a presigned URL was blocked on preflight.
// The server-side init + signPart steps succeeded (Vercel logs
// showed 200s), but the direct browser→R2 PUT failed silently with
// `TypeError: Failed to fetch` in the UI.
//
// This module builds the CORS ruleset we apply via PutBucketCorsCommand
// in scripts/apply-r2-cors.mjs. These tests pin the policy shape so
// a future edit can't accidentally drop ETag exposure (which would
// break multipart uploads — the client reads resp.headers.get("etag")
// to pass it to completeMultipart).

describe("buildR2CorsRules — policy invariants", () => {
  it("allows PUT (part upload), GET + HEAD (direct read)", () => {
    const [rule] = buildR2CorsRules();
    expect(rule?.AllowedMethods).toContain("PUT");
    expect(rule?.AllowedMethods).toContain("GET");
    expect(rule?.AllowedMethods).toContain("HEAD");
  });

  it("exposes ETag so client can capture it for multipart completion", () => {
    // Required by apps/web/src/lib/audio/use-multipart-upload.ts:
    //   const eTag = (resp.headers.get("etag") ?? "").replace(/"/g, "");
    // Without CORS ExposeHeaders, browsers hide non-whitelisted
    // response headers from JS even after the request succeeds.
    const [rule] = buildR2CorsRules();
    expect(rule?.ExposeHeaders).toContain("ETag");
  });

  it("allows the production origin skitza.app", () => {
    const [rule] = buildR2CorsRules();
    expect(rule?.AllowedOrigins).toContain("https://skitza.app");
  });

  it("allows local dev on http://localhost:3000", () => {
    const [rule] = buildR2CorsRules();
    expect(rule?.AllowedOrigins).toContain("http://localhost:3000");
  });

  it("allows Vercel previews (wildcard pattern)", () => {
    // R2/S3 CORS allows at most one `*` per AllowedOrigin entry.
    // `https://*.vercel.app` covers preview deploys without us having
    // to re-apply CORS on every preview URL.
    const [rule] = buildR2CorsRules();
    expect(rule?.AllowedOrigins).toContain("https://*.vercel.app");
  });

  it("allows all request headers (content-type + x-amz-* for signed PUTs)", () => {
    const [rule] = buildR2CorsRules();
    expect(rule?.AllowedHeaders).toContain("*");
  });

  it("sets a reasonable MaxAgeSeconds to reduce preflight overhead", () => {
    const [rule] = buildR2CorsRules();
    // 1 hour minimum; 1 day maximum. Longer = fewer preflights but
    // slower to roll out policy changes.
    expect(rule?.MaxAgeSeconds).toBeGreaterThanOrEqual(3600);
    expect(rule?.MaxAgeSeconds).toBeLessThanOrEqual(86400);
  });
});
