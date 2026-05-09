import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevPreviewBypass } from "./dev-preview";

// Dev-only preview bypass for the producer onboarding wizard.
//
// Lets a developer (or Claude in the preview tool) visually verify
// each onboarding step without needing to sign up a fresh producer
// every time. Two gates that BOTH have to be true:
//   1. NODE_ENV === "development" — Vercel sets NODE_ENV="production"
//      on every deployed environment (preview + production), so this
//      path is unreachable from any URL anyone might point at the
//      deployed app.
//   2. The request carries `?__preview=1` in its query string. Opt-in
//      per request; an accidental visit to /onboarding/welcome doesn't
//      trip the bypass, and there's no global "auth is off" mode.
//
// If either gate fails, the helper returns false → callers run their
// normal auth + role checks unmodified.
//
// vi.stubEnv is the right tool for NODE_ENV because Next's TS types
// declare NODE_ENV read-only — direct assignment fails typecheck even
// though it works at runtime. stubEnv goes through vitest's internal
// proxy so the type system is satisfied + the value is restored on
// vi.unstubAllEnvs() / between tests.

describe("isDevPreviewBypass — searchParams object shape (page components)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when NODE_ENV=development AND ?__preview=1", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass({ __preview: "1" })).toBe(true);
  });

  it("returns false when NODE_ENV=production (param ignored)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevPreviewBypass({ __preview: "1" })).toBe(false);
  });

  it("returns false when NODE_ENV=test (param ignored — only dev triggers)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isDevPreviewBypass({ __preview: "1" })).toBe(false);
  });

  it("returns false when in dev but no param present", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass({})).toBe(false);
  });

  it("returns false when in dev but param has the wrong value", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass({ __preview: "yes" })).toBe(false);
    expect(isDevPreviewBypass({ __preview: "0" })).toBe(false);
    expect(isDevPreviewBypass({ __preview: "" })).toBe(false);
  });

  it("returns false when param is an array (Next splits repeated keys)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass({ __preview: ["1", "1"] })).toBe(false);
  });

  it("ignores unrelated keys in the searchParams object", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass({ __preview: "1", utm_source: "linkedin" })).toBe(true);
  });
});

describe("isDevPreviewBypass — URLSearchParams shape (middleware)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for URLSearchParams with NODE_ENV=development AND ?__preview=1", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass(new URLSearchParams("__preview=1"))).toBe(true);
  });

  it("returns false for URLSearchParams when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevPreviewBypass(new URLSearchParams("__preview=1"))).toBe(false);
  });

  it("returns false for URLSearchParams missing the param", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass(new URLSearchParams("foo=bar"))).toBe(false);
  });

  it("returns false for URLSearchParams with the wrong value", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPreviewBypass(new URLSearchParams("__preview=0"))).toBe(false);
  });
});
