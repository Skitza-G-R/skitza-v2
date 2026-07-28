import { describe, expect, it } from "vitest";

import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
  decideFounderAuthorization,
  hasRecentMultiFactorVerification,
  type FounderAuthorizationFacts,
} from "./founder-authorization";

function founderFacts(
  overrides: Partial<FounderAuthorizationFacts> = {},
): FounderAuthorizationFacts {
  return {
    isImpersonated: false,
    userId: "user_founder",
    privateMetadata: {
      [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE,
    },
    mfaEnrolled: true,
    secondFactorAge: 0,
    ...overrides,
  };
}

describe("decideFounderAuthorization", () => {
  it("fails closed when the viewer is signed out", () => {
    expect(
      decideFounderAuthorization(founderFacts({ userId: null })),
    ).toEqual({
      allowed: false,
      reason: "signed-out",
    });
  });

  it("rejects an impersonated session even when it targets the founder", () => {
    expect(
      decideFounderAuthorization(founderFacts({ isImpersonated: true })),
    ).toEqual({
      allowed: false,
      reason: "impersonated-session",
    });
  });

  it.each([
    null,
    {},
    { [SKITZA_ADMIN_ROLE_METADATA_KEY]: "admin" },
    { [SKITZA_ADMIN_ROLE_METADATA_KEY]: true },
  ])(
    "requires the exact founder role in server-side private metadata",
    (privateMetadata) => {
      expect(
        decideFounderAuthorization(founderFacts({ privateMetadata })),
      ).toEqual({
        allowed: false,
        reason: "founder-role-required",
      });
    },
  );

  it("requires MFA enrollment even when the founder role is present", () => {
    expect(
      decideFounderAuthorization(founderFacts({ mfaEnrolled: false })),
    ).toEqual({
      allowed: false,
      reason: "mfa-enrollment-required",
    });
  });

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "requires proof that the current session completed a second factor",
    (secondFactorAge) => {
      expect(
        decideFounderAuthorization(founderFacts({ secondFactorAge })),
      ).toEqual({
        allowed: false,
        reason: "second-factor-required",
      });
    },
  );

  it.each([0, 1, 30, 0.5])(
    "allows only the founder with enrolled MFA and nonnegative second-factor proof",
    (secondFactorAge) => {
      expect(
        decideFounderAuthorization(founderFacts({ secondFactorAge })),
      ).toEqual({
        allowed: true,
        role: SKITZA_FOUNDER_ROLE,
        userId: "user_founder",
      });
    },
  );
});

describe("hasRecentMultiFactorVerification", () => {
  it("does not accept Clerk's graceful fallback without second-factor proof", () => {
    expect(
      hasRecentMultiFactorVerification({
        clerkReverificationSatisfied: true,
        factorVerificationAge: [0, -1],
        mfaEnrolled: true,
      }),
    ).toBe(false);
  });

  it("requires enrollment, Clerk reverification, and nonnegative factor age", () => {
    expect(
      hasRecentMultiFactorVerification({
        clerkReverificationSatisfied: true,
        factorVerificationAge: [0, 0],
        mfaEnrolled: true,
      }),
    ).toBe(true);
    expect(
      hasRecentMultiFactorVerification({
        clerkReverificationSatisfied: false,
        factorVerificationAge: [0, 0],
        mfaEnrolled: true,
      }),
    ).toBe(false);
    expect(
      hasRecentMultiFactorVerification({
        clerkReverificationSatisfied: true,
        factorVerificationAge: [0, 0],
        mfaEnrolled: false,
      }),
    ).toBe(false);
  });
});
