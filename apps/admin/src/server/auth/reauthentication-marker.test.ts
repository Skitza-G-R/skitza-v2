import { describe, expect, it } from "vitest";

import {
  ADMIN_REAUTHENTICATION_MARKER_TTL_MS,
  ADMIN_REAUTHENTICATION_MAX_ACCESS_TOKEN_AGE_MS,
  createReauthenticationMarker,
  evaluateReplacementAccessIdentity,
  verifyReauthenticationMarker,
  type ReauthenticationAccessIdentity,
  type VerifiedReauthenticationMarker,
} from "./reauthentication-marker";

const SECRET = "test-only-admin-reauthentication-secret-32-bytes";
const SESSION_ID = "sess_founder";
const ACCESS_SUBJECT = "access-founder";
const START_SECONDS = 1_800_000_000;
const START_MS = START_SECONDS * 1_000;
const PRIOR_FINGERPRINT = "a".repeat(43);
const REPLACEMENT_FINGERPRINT = "b".repeat(43);

const PRIOR_IDENTITY: ReauthenticationAccessIdentity = {
  issuedAt: START_SECONDS - 30,
  subject: ACCESS_SUBJECT,
  tokenFingerprint: PRIOR_FINGERPRINT,
};

function tokenFor(
  overrides: Partial<{
    sessionId: string;
    accessIdentity: ReauthenticationAccessIdentity;
    initiatedAtMs: number;
    secret: string;
  }> = {},
): string {
  return createReauthenticationMarker({
    sessionId: SESSION_ID,
    accessIdentity: PRIOR_IDENTITY,
    initiatedAtMs: START_MS,
    secret: SECRET,
    ...overrides,
  });
}

function verifyToken(
  overrides: Partial<{
    token: string;
    sessionId: string;
    accessSubject: string;
    secret: string;
    nowMs: number;
  }> = {},
) {
  return verifyReauthenticationMarker({
    token: tokenFor(),
    sessionId: SESSION_ID,
    accessSubject: ACCESS_SUBJECT,
    secret: SECRET,
    nowMs: START_MS,
    ...overrides,
  });
}

function verifiedMarker(
  overrides: Partial<VerifiedReauthenticationMarker> = {},
): VerifiedReauthenticationMarker {
  return {
    valid: true,
    accessSubject: ACCESS_SUBJECT,
    initiatedAtMs: START_MS,
    priorAccessIssuedAt: PRIOR_IDENTITY.issuedAt,
    priorTokenFingerprint: PRIOR_FINGERPRINT,
    ...overrides,
  };
}

function replacementIdentity(
  overrides: Partial<ReauthenticationAccessIdentity> = {},
): ReauthenticationAccessIdentity {
  return {
    issuedAt: START_SECONDS,
    subject: ACCESS_SUBJECT,
    tokenFingerprint: REPLACEMENT_FINGERPRINT,
    ...overrides,
  };
}

describe("admin reauthentication marker", () => {
  it("round-trips the stored lock facts without embedding either binding", () => {
    const token = tokenFor();

    expect(token).not.toContain(SESSION_ID);
    expect(token).not.toContain(ACCESS_SUBJECT);
    expect(verifyToken({ token })).toEqual({
      valid: true,
      accessSubject: ACCESS_SUBJECT,
      initiatedAtMs: START_MS,
      priorAccessIssuedAt: PRIOR_IDENTITY.issuedAt,
      priorTokenFingerprint: PRIOR_FINGERPRINT,
    });
  });

  it("rejects payload tampering and different Clerk or Access bindings", () => {
    const token = tokenFor();
    const [version, , priorIssuedAt, fingerprint, signature] =
      token.split(".");

    expect(
      verifyToken({
        token: [
          version,
          String(START_MS + 1),
          priorIssuedAt,
          fingerprint,
          signature,
        ].join("."),
      }),
    ).toEqual({ valid: false, reason: "invalid-signature" });
    expect(verifyToken({ token, sessionId: "sess_other" })).toEqual({
      valid: false,
      reason: "invalid-signature",
    });
    expect(verifyToken({ token, accessSubject: "access-other" })).toEqual({
      valid: false,
      reason: "invalid-signature",
    });
  });

  it("rejects malformed marker fields before time evaluation", () => {
    expect(verifyToken({ token: "not-a-marker" })).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(
      verifyToken({
        token: [
          "v1",
          "01",
          String(START_SECONDS),
          PRIOR_FINGERPRINT,
          "c".repeat(43),
        ].join("."),
      }),
    ).toEqual({ valid: false, reason: "malformed" });
    expect(
      verifyToken({
        token: [
          "v1",
          String(START_MS),
          String(START_SECONDS),
          "bad",
          "c".repeat(43),
        ].join("."),
      }),
    ).toEqual({ valid: false, reason: "malformed" });
  });

  it("is valid until one millisecond before its exact ten-minute TTL", () => {
    expect(
      verifyToken({
        nowMs: START_MS + ADMIN_REAUTHENTICATION_MARKER_TTL_MS - 1,
      }),
    ).toMatchObject({ valid: true });
    expect(
      verifyToken({
        nowMs: START_MS + ADMIN_REAUTHENTICATION_MARKER_TTL_MS,
      }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("fails closed for backwards or invalid verification time", () => {
    expect(verifyToken({ nowMs: START_MS - 1 })).toEqual({
      valid: false,
      reason: "invalid-time",
    });
    expect(verifyToken({ nowMs: Number.NaN })).toEqual({
      valid: false,
      reason: "invalid-time",
    });
  });

  it("keeps weak secret values out of configuration errors", () => {
    const weakSecret = "do-not-print";

    expect(() => tokenFor({ secret: weakSecret })).toThrow(
      "Admin reauthentication marker secret is invalid",
    );
    try {
      tokenFor({ secret: weakSecret });
    } catch (error) {
      expect(String(error)).not.toContain(weakSecret);
    }
  });
});

describe("replacement Access identity evaluation", () => {
  it("accepts a new, recent token for the marker's Access subject", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity(),
        nowMs: START_MS + 1_000,
      }),
    ).toEqual({ accepted: true });
  });

  it("requires the same subject and a different token fingerprint", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          subject: "access-other",
        }),
        nowMs: START_MS,
      }),
    ).toEqual({ accepted: false, reason: "subject-mismatch" });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          tokenFingerprint: PRIOR_FINGERPRINT,
        }),
        nowMs: START_MS,
      }),
    ).toEqual({ accepted: false, reason: "token-reused" });
  });

  it("requires issuance strictly after the prior Access token", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          issuedAt: PRIOR_IDENTITY.issuedAt - 1,
        }),
        nowMs: START_MS,
      }),
    ).toEqual({
      accepted: false,
      reason: "issued-before-prior-token",
    });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          issuedAt: PRIOR_IDENTITY.issuedAt,
        }),
        nowMs: START_MS,
      }),
    ).toEqual({
      accepted: false,
      reason: "issued-before-prior-token",
    });
  });

  it("rejects every token issued before the marker's rounded-up second", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker({ initiatedAtMs: START_MS + 1 }),
        replacementIdentity: replacementIdentity({
          issuedAt: START_SECONDS,
        }),
        nowMs: START_MS + 1_000,
      }),
    ).toEqual({
      accepted: false,
      reason: "issued-before-initiation",
    });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker({ initiatedAtMs: START_MS + 1 }),
        replacementIdentity: replacementIdentity({
          issuedAt: START_SECONDS + 1,
        }),
        nowMs: START_MS + 1_000,
      }),
    ).toEqual({ accepted: true });
  });

  it("accepts a replacement token at exactly five minutes old", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity(),
        nowMs:
          START_MS + ADMIN_REAUTHENTICATION_MAX_ACCESS_TOKEN_AGE_MS,
      }),
    ).toEqual({ accepted: true });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity(),
        nowMs:
          START_MS +
          ADMIN_REAUTHENTICATION_MAX_ACCESS_TOKEN_AGE_MS +
          1,
      }),
    ).toEqual({ accepted: false, reason: "token-too-old" });
  });

  it("fails closed for future issuance, backwards time, and marker expiry", () => {
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          issuedAt: START_SECONDS + 1,
        }),
        nowMs: START_MS,
      }),
    ).toEqual({ accepted: false, reason: "invalid-time" });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity(),
        nowMs: START_MS - 1,
      }),
    ).toEqual({ accepted: false, reason: "invalid-time" });
    expect(
      evaluateReplacementAccessIdentity({
        marker: verifiedMarker(),
        replacementIdentity: replacementIdentity({
          issuedAt: START_SECONDS + 9 * 60,
        }),
        nowMs: START_MS + ADMIN_REAUTHENTICATION_MARKER_TTL_MS,
      }),
    ).toEqual({ accepted: false, reason: "marker-expired" });
  });
});
