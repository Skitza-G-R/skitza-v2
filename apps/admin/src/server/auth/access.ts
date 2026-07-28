import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import {
  decideFounderAuthorization,
  hasRecentMultiFactorVerification,
  SKITZA_ADMIN_ROLE_METADATA_KEY,
  SKITZA_FOUNDER_ROLE,
  type FounderAuthorizationDenialReason,
} from "./founder-authorization";
import {
  createInactivityToken,
  evaluateInactivityTimeout,
  verifyInactivityToken,
} from "./inactivity-token";

export const ADMIN_ACTIVITY_COOKIE_NAME = "skitza-admin-activity";

export type AdminAccessFailureReason =
  | FounderAuthorizationDenialReason
  | "activity-lock-required"
  | "configuration-invalid";

export class AdminAccessError extends Error {
  readonly reason: AdminAccessFailureReason;

  constructor(reason: AdminAccessFailureReason) {
    super("Admin access denied.");
    this.name = "AdminAccessError";
    this.reason = reason;
  }
}

export type FounderIdentity = Readonly<{
  hasRecentMultiFactorVerification: boolean;
  sessionId: string;
  userId: string;
}>;

function readAdminSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new AdminAccessError("configuration-invalid");
  }
  return secret;
}

async function readFounderFacts() {
  const authState = await auth();
  if (!authState.userId || !authState.sessionId) {
    throw new AdminAccessError("signed-out");
  }
  if (authState.actor) {
    throw new AdminAccessError("impersonated-session");
  }

  const user = await currentUser();
  if (!user || user.id !== authState.userId) {
    throw new AdminAccessError("signed-out");
  }

  return {
    authState,
    hasRecentMultiFactorVerification: hasRecentMultiFactorVerification({
      clerkReverificationSatisfied:
        user.twoFactorEnabled &&
        authState.has({ reverification: "strict_mfa" }),
      factorVerificationAge: authState.factorVerificationAge,
      mfaEnrolled: user.twoFactorEnabled,
    }),
    mfaEnrolled: user.twoFactorEnabled,
    privateMetadata: user.privateMetadata,
    sessionId: authState.sessionId,
    userId: authState.userId,
  };
}

export async function requireFounderRole(): Promise<FounderIdentity> {
  const facts = await readFounderFacts();

  if (
    facts.privateMetadata[SKITZA_ADMIN_ROLE_METADATA_KEY] !==
    SKITZA_FOUNDER_ROLE
  ) {
    throw new AdminAccessError("founder-role-required");
  }

  return {
    hasRecentMultiFactorVerification:
      facts.hasRecentMultiFactorVerification,
    sessionId: facts.sessionId,
    userId: facts.userId,
  };
}

export async function requireFounderWithMfaEnrollment(): Promise<FounderIdentity> {
  const facts = await readFounderFacts();

  if (
    facts.privateMetadata[SKITZA_ADMIN_ROLE_METADATA_KEY] !==
    SKITZA_FOUNDER_ROLE
  ) {
    throw new AdminAccessError("founder-role-required");
  }
  if (!facts.mfaEnrolled) {
    throw new AdminAccessError("mfa-enrollment-required");
  }

  return {
    hasRecentMultiFactorVerification:
      facts.hasRecentMultiFactorVerification,
    sessionId: facts.sessionId,
    userId: facts.userId,
  };
}

export async function requireFounderAuthorization(): Promise<FounderIdentity> {
  const facts = await readFounderFacts();
  const decision = decideFounderAuthorization({
    isImpersonated: Boolean(facts.authState.actor),
    userId: facts.userId,
    privateMetadata: facts.privateMetadata,
    mfaEnrolled: facts.mfaEnrolled,
    secondFactorAge: facts.authState.factorVerificationAge?.[1] ?? null,
  });

  if (!decision.allowed) {
    throw new AdminAccessError(decision.reason);
  }

  return {
    hasRecentMultiFactorVerification:
      facts.hasRecentMultiFactorVerification,
    sessionId: facts.sessionId,
    userId: decision.userId,
  };
}

export async function requireActiveAdminAccess(): Promise<FounderIdentity> {
  const identity = await requireFounderAuthorization();
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_ACTIVITY_COOKIE_NAME)?.value;
  if (!token) {
    throw new AdminAccessError("activity-lock-required");
  }

  let verification;
  try {
    verification = verifyInactivityToken({
      token,
      sessionId: identity.sessionId,
      secret: readAdminSessionSecret(),
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  if (!verification.valid) {
    throw new AdminAccessError("activity-lock-required");
  }

  const timeout = evaluateInactivityTimeout({
    lastActivityAtMs: verification.lastActivityAtMs,
    nowMs: Date.now(),
  });
  if (timeout.locked) {
    throw new AdminAccessError("activity-lock-required");
  }

  return identity;
}

export async function refreshAdminActivity(
  sessionId: string,
  nowMs = Date.now(),
): Promise<void> {
  let token: string;
  try {
    token = createInactivityToken({
      sessionId,
      secret: readAdminSessionSecret(),
      lastActivityAtMs: nowMs,
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: ADMIN_ACTIVITY_COOKIE_NAME,
    value: token,
    httpOnly: true,
    maxAge: 30 * 60,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAdminActivity(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_ACTIVITY_COOKIE_NAME);
}

/**
 * Clears the shared activity cookie only when the server-side activity record
 * is already invalid or expired. A stale background tab cannot lock a session
 * that another tab has refreshed.
 */
export type AdminActivityLockDecision =
  | Readonly<{ locked: true }>
  | Readonly<{ locked: false; retryAfterMs: number }>;

export async function lockAdminActivityIfInactive(
  sessionId: string,
  nowMs = Date.now(),
): Promise<AdminActivityLockDecision> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_ACTIVITY_COOKIE_NAME)?.value;
  if (!token) {
    cookieStore.delete(ADMIN_ACTIVITY_COOKIE_NAME);
    return { locked: true };
  }

  let verification;
  try {
    verification = verifyInactivityToken({
      token,
      sessionId,
      secret: readAdminSessionSecret(),
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  if (verification.valid) {
    const timeout = evaluateInactivityTimeout({
      lastActivityAtMs: verification.lastActivityAtMs,
      nowMs,
    });
    if (!timeout.locked) {
      return {
        locked: false,
        retryAfterMs: timeout.locksAtMs - nowMs,
      };
    }
  }

  cookieStore.delete(ADMIN_ACTIVITY_COOKIE_NAME);
  return { locked: true };
}
