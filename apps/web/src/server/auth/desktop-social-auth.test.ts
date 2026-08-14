import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  consumeDesktopAuthorizationCode,
  desktopAuthCallbackUrl,
  desktopAuthCodeDigest,
  desktopAuthStateDigest,
  desktopPkceChallenge,
  issueDesktopAuthorizationCode,
  parseDesktopAuthStartUrl,
  trustedDesktopAuthOrigin,
  type DesktopSocialAuthStore,
} from "./desktop-social-auth";

const STATE = "s".repeat(43);
const CODE = "c".repeat(43);
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

function store() {
  const consume = vi.fn<DesktopSocialAuthStore["consume"]>();
  const issue = vi.fn<DesktopSocialAuthStore["issue"]>();
  return { consume, issue } satisfies DesktopSocialAuthStore;
}

describe("desktop social-auth values", () => {
  it("requires an active producer when consuming a one-use code", () => {
    const source = readFileSync(new URL("./desktop-social-auth.ts", import.meta.url), "utf8");

    expect(source).toContain(
      ".where(and(eq(producers.id, consumed.producerId), isNull(producers.closedAt)))",
    );
  });

  it("accepts only the exact HTTPS start surface and S256 binding", () => {
    const exact = new URL(
      `https://proof.skitza.app/api/desktop/auth/start?state=${STATE}` +
        `&code_challenge=${CHALLENGE}&code_challenge_method=S256`,
    );
    expect(parseDesktopAuthStartUrl(exact, "https://proof.skitza.app")).toEqual({
      codeChallenge: CHALLENGE,
      state: STATE,
    });

    for (const url of [
      new URL(exact.toString().replace("https:", "http:")),
      new URL(`${exact.toString()}&extra=1`),
      new URL(exact.toString().replace("S256", "plain")),
      new URL(exact.toString().replace(STATE, "short")),
      new URL(exact.toString().replace("proof.skitza.app", "evil.example")),
    ]) {
      expect(parseDesktopAuthStartUrl(url, "https://proof.skitza.app")).toBeNull();
    }
    expect(trustedDesktopAuthOrigin("https://proof.skitza.app")).toBe("https://proof.skitza.app");
    expect(trustedDesktopAuthOrigin("http://proof.skitza.app")).toBeNull();
    expect(trustedDesktopAuthOrigin("https://proof.skitza.app/path")).toBeNull();
  });

  it("builds a callback containing code and state only", () => {
    const callback = new URL(desktopAuthCallbackUrl({ code: CODE, state: STATE }));
    expect(callback.protocol).toBe("skitza:");
    expect(callback.host).toBe("auth");
    expect(callback.pathname).toBe("/callback");
    expect(Array.from(callback.searchParams.keys())).toEqual(["code", "state"]);
    expect(callback.searchParams.get("code")).toBe(CODE);
    expect(callback.searchParams.get("state")).toBe(STATE);
  });

  it("stores only a digest and expires the random code in sixty seconds", async () => {
    const authStore = store();
    await expect(
      issueDesktopAuthorizationCode({
        codeChallenge: CHALLENGE,
        producerId: "producer-1",
        randomCode: () => CODE,
        state: STATE,
        store: authStore,
      }),
    ).resolves.toBe(CODE);
    expect(authStore.issue).toHaveBeenCalledWith({
      codeDigest: desktopAuthCodeDigest(CODE),
      pkceChallenge: CHALLENGE,
      producerId: "producer-1",
      stateDigest: desktopAuthStateDigest(STATE),
    });
    expect(JSON.stringify(authStore.issue.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(authStore.issue.mock.calls)).not.toContain(VERIFIER);
    expect(JSON.stringify(authStore.issue.mock.calls)).not.toContain(STATE);
  });

  it("derives the S256 binding and delegates one atomic consume", async () => {
    const authStore = store();
    authStore.consume.mockResolvedValue({ clerkUserId: "user-1" });
    await expect(
      consumeDesktopAuthorizationCode({
        code: CODE,
        codeVerifier: VERIFIER,
        store: authStore,
      }),
    ).resolves.toEqual({ clerkUserId: "user-1" });
    expect(authStore.consume).toHaveBeenCalledWith({
      codeDigest: desktopAuthCodeDigest(CODE),
      pkceChallenge: desktopPkceChallenge(VERIFIER),
    });
    expect(authStore.consume).toHaveBeenCalledTimes(1);
  });
});
