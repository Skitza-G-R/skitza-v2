export const SKITZA_ADMIN_ROLE_METADATA_KEY = "skitzaAdminRole" as const;
export const SKITZA_FOUNDER_ROLE = "founder" as const;

export type FounderAuthorizationFacts = Readonly<{
  accessIdentityMatches: boolean;
  isImpersonated: boolean;
  userId: string | null;
  privateMetadata: Readonly<Record<string, unknown>> | null;
}>;

export type FounderAuthorizationDenialReason =
  | "signed-out"
  | "impersonated-session"
  | "founder-role-required"
  | "access-identity-mismatch";

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

/**
 * Pure authorization policy for the admin boundary.
 *
 * The caller is responsible for sourcing `privateMetadata` from Clerk's
 * server-only Backend User object and for cryptographically validating the
 * Cloudflare Access application token before this decision. No
 * browser-controlled metadata belongs in this policy.
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

  if (!facts.accessIdentityMatches) {
    return { allowed: false, reason: "access-identity-mismatch" };
  }

  return {
    allowed: true,
    role: SKITZA_FOUNDER_ROLE,
    userId: facts.userId,
  };
}
