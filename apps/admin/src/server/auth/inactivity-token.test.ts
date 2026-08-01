import { describe, expect, it } from "vitest";

import {
  ADMIN_INACTIVITY_TIMEOUT_MS,
  createInactivityToken,
  evaluateInactivityTimeout,
  verifyInactivityToken,
} from "./inactivity-token";

const SECRET = "test-only-admin-inactivity-secret-32-bytes";
const SESSION_ID = "sess_founder";
const ACCESS_SUBJECT = "access-founder-subject";
const START_MS = 1_800_000;
const ACCESS_ISSUED_AT_SEC = 1_700_000_000;

function tokenFor(
  overrides: Partial<{
    sessionId: string;
    accessSubject: string;
    secret: string;
    lastActivityAtMs: number;
    minimumAccessIssuedAtSec: number;
  }> = {},
): string {
  return createInactivityToken({
    sessionId: SESSION_ID,
    accessSubject: ACCESS_SUBJECT,
    secret: SECRET,
    lastActivityAtMs: START_MS,
    minimumAccessIssuedAtSec: ACCESS_ISSUED_AT_SEC,
    ...overrides,
  });
}

describe("admin inactivity token", () => {
  it("round-trips signed activity and Access freshness without embedding identities", () => {
    const token = tokenFor();

    expect(token).not.toContain(SESSION_ID);
    expect(token).not.toContain(ACCESS_SUBJECT);
    expect(
      verifyInactivityToken({
        token,
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({
      valid: true,
      lastActivityAtMs: START_MS,
      minimumAccessIssuedAtSec: ACCESS_ISSUED_AT_SEC,
    });
  });

  it("rejects a timestamp changed without a new signature", () => {
    const token = tokenFor();
    const [, , rawAccessIssuedAt, signature] = token.split(".");
    expect(rawAccessIssuedAt).toBeDefined();
    expect(signature).toBeDefined();
    if (!rawAccessIssuedAt || !signature) {
      throw new Error("Expected signed token fields");
    }
    const tampered = [
      "v2",
      String(START_MS + 1),
      rawAccessIssuedAt,
      signature,
    ].join(".");

    expect(
      verifyInactivityToken({
        token: tampered,
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects an Access issued-at floor changed without a new signature", () => {
    const token = tokenFor();
    const [, rawTimestamp, , signature] = token.split(".");
    expect(rawTimestamp).toBeDefined();
    expect(signature).toBeDefined();
    if (!rawTimestamp || !signature) {
      throw new Error("Expected signed token fields");
    }
    const tampered = [
      "v2",
      rawTimestamp,
      String(ACCESS_ISSUED_AT_SEC + 1),
      signature,
    ].join(".");

    expect(
      verifyInactivityToken({
        token: tampered,
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects a token presented by a different Clerk session", () => {
    expect(
      verifyInactivityToken({
        token: tokenFor(),
        sessionId: "sess_other",
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects a token presented by a different Access subject", () => {
    expect(
      verifyInactivityToken({
        token: tokenFor(),
        sessionId: SESSION_ID,
        accessSubject: "access-other-subject",
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects malformed tokens before evaluating activity", () => {
    expect(
      verifyInactivityToken({
        token: "not-a-token",
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects legacy and non-canonical numeric token fields", () => {
    expect(
      verifyInactivityToken({
        token: "v1.1800000.signature",
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "malformed" });
    expect(
      verifyInactivityToken({
        token: `v2.1800000.01700000000.${"a".repeat(43)}`,
        sessionId: SESSION_ID,
        accessSubject: ACCESS_SUBJECT,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "malformed" });
  });

  it("stays active one millisecond before the boundary", () => {
    expect(
      evaluateInactivityTimeout({
        lastActivityAtMs: START_MS,
        nowMs: START_MS + ADMIN_INACTIVITY_TIMEOUT_MS - 1,
      }),
    ).toEqual({
      locked: false,
      inactiveForMs: ADMIN_INACTIVITY_TIMEOUT_MS - 1,
      locksAtMs: START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
    });
  });

  it("locks at exactly 30 inactive minutes and remains locked afterward", () => {
    expect(
      evaluateInactivityTimeout({
        lastActivityAtMs: START_MS,
        nowMs: START_MS + ADMIN_INACTIVITY_TIMEOUT_MS,
      }),
    ).toEqual({ locked: true, reason: "expired" });
    expect(
      evaluateInactivityTimeout({
        lastActivityAtMs: START_MS,
        nowMs: START_MS + ADMIN_INACTIVITY_TIMEOUT_MS + 1,
      }),
    ).toEqual({ locked: true, reason: "expired" });
  });

  it("fails closed for invalid or backwards time", () => {
    expect(
      evaluateInactivityTimeout({
        lastActivityAtMs: START_MS,
        nowMs: START_MS - 1,
      }),
    ).toEqual({ locked: true, reason: "invalid-time" });
  });

  it("keeps secret values out of configuration errors", () => {
    const weakSecret = "do-not-print";

    expect(() => tokenFor({ secret: weakSecret })).toThrow(
      "Admin inactivity token secret is invalid",
    );
    try {
      tokenFor({ secret: weakSecret });
    } catch (error) {
      expect(String(error)).not.toContain(weakSecret);
    }
  });

  it("rejects invalid identity and timestamp inputs", () => {
    expect(() => tokenFor({ accessSubject: "" })).toThrow(
      "Cloudflare Access subject is invalid",
    );
    expect(() =>
      tokenFor({ minimumAccessIssuedAtSec: Number.NaN }),
    ).toThrow("Cloudflare Access issued-at floor is invalid");
    expect(() => tokenFor({ lastActivityAtMs: -1 })).toThrow(
      "Admin activity timestamp is invalid",
    );
  });
});
