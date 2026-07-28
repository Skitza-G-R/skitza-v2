export const SKITZA_ADMIN_ROLE_METADATA_KEY = "skitzaAdminRole" as const;
export const SKITZA_FOUNDER_ROLE = "founder" as const;

export type FounderAuthorizationFacts = Readonly<{
  isImpersonated: boolean;
  userId: string | null;
  privateMetadata: Readonly<Record<string, unknown>> | null;
  mfaEnrolled: boolean;
  secondFactorAge: number | null;
}>;

export type FounderAuthorizationDenialReason =
  | "signed-out"
  | "impersonated-session"
  | "founder-role-required"
  | "mfa-enrollment-required"
  | "second-factor-required";

export type FounderAuthorizationDecision =
  | Readonly<{
      allowed: true;
      role: typeof SKITZA_FOUNDER_ROLE;
      userId: string;
    }>
  | Readonly<{
      allowed: false;
      reason: FounderAuthorizationDenialReason;
    }>;

export function hasRecentMultiFactorVerification(input: Readonly<{
  clerkReverificationSatisfied: boolean;
  factorVerificationAge: readonly [number, number] | null;
  mfaEnrolled: boolean;
}>): boolean {
  const secondFactorAge = input.factorVerificationAge?.[1];
  return (
    input.mfaEnrolled &&
    input.clerkReverificationSatisfied &&
    secondFactorAge !== undefined &&
    Number.isFinite(secondFactorAge) &&
    secondFactorAge >= 0
  );
}

/**
 * Pure authorization policy for the admin boundary.
 *
 * The caller is responsible for sourcing `privateMetadata` from Clerk's
 * server-only Backend User object. No browser-controlled metadata belongs in
 * this decision.
 */
export function decideFounderAuthorization(
  facts: FounderAuthorizationFacts,
): FounderAuthorizationDecision {
  if (!facts.userId || facts.userId.trim().length === 0) {
    return { allowed: false, reason: "signed-out" };
  }

  if (facts.isImpersonated) {
    return { allowed: false, reason: "impersonated-session" };
  }

  if (
    facts.privateMetadata?.[SKITZA_ADMIN_ROLE_METADATA_KEY] !==
    SKITZA_FOUNDER_ROLE
  ) {
    return { allowed: false, reason: "founder-role-required" };
  }

  if (!facts.mfaEnrolled) {
    return { allowed: false, reason: "mfa-enrollment-required" };
  }

  if (
    facts.secondFactorAge === null ||
    !Number.isFinite(facts.secondFactorAge) ||
    facts.secondFactorAge < 0
  ) {
    return { allowed: false, reason: "second-factor-required" };
  }

  return {
    allowed: true,
    role: SKITZA_FOUNDER_ROLE,
    userId: facts.userId,
  };
}
