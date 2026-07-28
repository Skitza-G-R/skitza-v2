import { describe, expect, it } from "vitest";

import {
  ADMIN_INACTIVITY_TIMEOUT_MS,
  createInactivityToken,
  evaluateInactivityTimeout,
  verifyInactivityToken,
} from "./inactivity-token";

const SECRET = "test-only-admin-inactivity-secret-32-bytes";
const SESSION_ID = "sess_founder";
const START_MS = 1_800_000;

function tokenFor(
  overrides: Partial<{
    sessionId: string;
    secret: string;
    lastActivityAtMs: number;
  }> = {},
): string {
  return createInactivityToken({
    sessionId: SESSION_ID,
    secret: SECRET,
    lastActivityAtMs: START_MS,
    ...overrides,
  });
}

describe("admin inactivity token", () => {
  it("round-trips a signed timestamp without embedding the Clerk session ID", () => {
    const token = tokenFor();

    expect(token).not.toContain(SESSION_ID);
    expect(
      verifyInactivityToken({
        token,
        sessionId: SESSION_ID,
        secret: SECRET,
      }),
    ).toEqual({ valid: true, lastActivityAtMs: START_MS });
  });

  it("rejects a timestamp changed without a new signature", () => {
    const token = tokenFor();
    const [, , signature] = token.split(".");
    expect(signature).toBeDefined();
    if (!signature) {
      throw new Error("Expected a token signature");
    }
    const tampered = ["v1", String(START_MS + 1), signature].join(".");

    expect(
      verifyInactivityToken({
        token: tampered,
        sessionId: SESSION_ID,
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects a token presented by a different Clerk session", () => {
    expect(
      verifyInactivityToken({
        token: tokenFor(),
        sessionId: "sess_other",
        secret: SECRET,
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects malformed tokens before evaluating activity", () => {
    expect(
      verifyInactivityToken({
        token: "not-a-token",
        sessionId: SESSION_ID,
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
});
