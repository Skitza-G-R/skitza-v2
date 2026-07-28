import { describe, expect, it } from "vitest";

import {
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
  decideFounderAuthorization,
  type FounderAuthorizationFacts,
} from "./founder-authorization";

function founderFacts(
  overrides: Partial<FounderAuthorizationFacts> = {},
): FounderAuthorizationFacts {
  return {
    accessIdentityMatches: true,
    isImpersonated: false,
    userId: "user_founder",
    privateMetadata: {
      [SKITZA_ADMIN_ROLE_METADATA_KEY]: SKITZA_FOUNDER_ROLE,
    },
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

  it("requires the Access identity to match a verified Clerk email", () => {
    expect(
      decideFounderAuthorization(
        founderFacts({ accessIdentityMatches: false }),
      ),
    ).toEqual({
      allowed: false,
      reason: "access-identity-mismatch",
    });
  });

  it("allows only the matching Access and Clerk founder identities", () => {
    expect(decideFounderAuthorization(founderFacts())).toEqual({
      allowed: true,
      role: SKITZA_FOUNDER_ROLE,
      userId: "user_founder",
    });
  });
});
