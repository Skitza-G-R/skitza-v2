import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const launchPageSource = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

describe("public launch bootstrap route contract", () => {
  it("is a force-static document that delegates only to the local resume boundary", () => {
    expect(launchPageSource).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-static["']/,
    );
    expect(launchPageSource).toContain("<Suspense");
    expect(launchPageSource).toMatch(/<RuntimeResumeBoundary\s+navigate\s*\/>/);
    expect(launchPageSource).toContain("fallback={<RuntimeLaunchCover />}");
    expect(launchPageSource).not.toContain("<RuntimeDestinationScaffold");
  });

  it("contains no server authentication, request state, redirect, or data call", () => {
    for (const forbidden of [
      /@clerk\/nextjs\/server/,
      /\bauth\s*\(/,
      /\bcurrentUser\s*\(/,
      /\bcookies\s*\(/,
      /\bheaders\s*\(/,
      /\bredirect\s*\(/,
      /\bfetch\s*\(/,
      /\bcreateCaller\s*\(/,
      /\bappRouter\b/,
      /\bserver-only\b/,
      /~\/server\//,
    ]) {
      expect(launchPageSource).not.toMatch(forbidden);
    }
  });
});
