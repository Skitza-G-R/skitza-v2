import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies, headers } from "next/headers";

import {
  CloudflareAccessVerificationError,
  verifyCloudflareAccessHeaders,
  type CloudflareAccessIdentity,
} from "./cloudflare-access";
import {
  decideFounderAuthorization,
  type FounderAuthorizationDenialReason,
} from "./founder-authorization";
import {
  createInactivityToken,
  evaluateInactivityTimeout,
  verifyInactivityToken,
} from "./inactivity-token";
import {
  ADMIN_REAUTHENTICATION_MARKER_TTL_MS,
  createReauthenticationMarker,
  evaluateReplacementAccessIdentity,
  verifyReauthenticationMarker,
} from "./reauthentication-marker";

export const ADMIN_ACTIVITY_COOKIE_NAME = "skitza-admin-activity";
export const ADMIN_REAUTHENTICATION_COOKIE_NAME =
  "skitza-admin-reauthentication";
export const CLOUDFLARE_ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

const ADMIN_ACTIVITY_COOKIE_MAX_AGE_SECONDS = 30 * 60;
const ADMIN_REAUTHENTICATION_COOKIE_MAX_AGE_SECONDS =
  ADMIN_REAUTHENTICATION_MARKER_TTL_MS / 1_000;

export type AdminAccessFailureReason =
  | FounderAuthorizationDenialReason
  | "access-proof-required"
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
  accessEmail: string;
  accessIssuedAt: number;
  accessSubject: string;
  accessTokenFingerprint: string;
  sessionId: string;
  userId: string;
}>;

export type AdminActivityLockDecision =
  | Readonly<{ locked: true }>
  | Readonly<{ locked: false; retryAfterMs: number }>;

export type AdminUnlockDecision =
  | Readonly<{ unlocked: true }>
  | Readonly<{
      unlocked: false;
      reauthenticationRequired: true;
      logoutPath: typeof CLOUDFLARE_ACCESS_LOGOUT_PATH;
    }>;

function readAdminSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new AdminAccessError("configuration-invalid");
  }
  return secret;
}

function mapCloudflareAccessError(error: unknown): never {
  if (
    error instanceof CloudflareAccessVerificationError &&
    error.reason === "configuration-invalid"
  ) {
    throw new AdminAccessError("configuration-invalid");
  }
  throw new AdminAccessError("access-proof-required");
}

async function readVerifiedAccessIdentity(): Promise<CloudflareAccessIdentity> {
  try {
    return await verifyCloudflareAccessHeaders(await headers());
  } catch (error) {
    return mapCloudflareAccessError(error);
  }
}

function hasMatchingVerifiedClerkEmail(
  accessEmail: string,
  emailAddresses: ReadonlyArray<{
    emailAddress: string;
    verification?: Readonly<{ status?: string | null }> | null;
  }>,
): boolean {
  return emailAddresses.some(
    ({ emailAddress, verification }) =>
      verification?.status === "verified" &&
      emailAddress.trim().toLowerCase() === accessEmail,
  );
}

async function readFounderFacts() {
  // Access is deliberately verified before Clerk so every dynamic request
  // fails closed at the outer infrastructure-authentication boundary.
  const accessIdentity = await readVerifiedAccessIdentity();
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
    accessIdentity,
    accessIdentityMatches: hasMatchingVerifiedClerkEmail(
      accessIdentity.email,
      user.emailAddresses,
    ),
    isImpersonated: false,
    privateMetadata: user.privateMetadata,
    sessionId: authState.sessionId,
    userId: authState.userId,
  };
}

async function requireFounder(): Promise<FounderIdentity> {
  const facts = await readFounderFacts();
  const decision = decideFounderAuthorization({
    accessIdentityMatches: facts.accessIdentityMatches,
    isImpersonated: facts.isImpersonated,
    privateMetadata: facts.privateMetadata,
    userId: facts.userId,
  });

  if (!decision.allowed) {
    throw new AdminAccessError(decision.reason);
  }

  return {
    accessEmail: facts.accessIdentity.email,
    accessIssuedAt: facts.accessIdentity.issuedAt,
    accessSubject: facts.accessIdentity.subject,
    accessTokenFingerprint: facts.accessIdentity.tokenFingerprint,
    sessionId: facts.sessionId,
    userId: decision.userId,
  };
}

export async function requireFounderRole(): Promise<FounderIdentity> {
  return requireFounder();
}

export async function requireFounderAuthorization(): Promise<FounderIdentity> {
  return requireFounder();
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
      accessSubject: identity.accessSubject,
      secret: readAdminSessionSecret(),
      sessionId: identity.sessionId,
      token,
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  if (
    !verification.valid ||
    identity.accessIssuedAt < verification.minimumAccessIssuedAtSec
  ) {
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

function activityCookieValue(
  identity: FounderIdentity,
  secret: string,
  nowMs: number,
): string {
  return createInactivityToken({
    accessSubject: identity.accessSubject,
    lastActivityAtMs: nowMs,
    minimumAccessIssuedAtSec: identity.accessIssuedAt,
    secret,
    sessionId: identity.sessionId,
  });
}

async function setAdminActivity(
  identity: FounderIdentity,
  nowMs: number,
): Promise<void> {
  let token: string;
  try {
    token = activityCookieValue(identity, readAdminSessionSecret(), nowMs);
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: ADMIN_ACTIVITY_COOKIE_MAX_AGE_SECONDS,
    name: ADMIN_ACTIVITY_COOKIE_NAME,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    value: token,
  });
}

export async function refreshAdminActivity(
  identity: FounderIdentity,
  nowMs = Date.now(),
): Promise<void> {
  await setAdminActivity(identity, nowMs);
}

export async function clearAdminActivity(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_ACTIVITY_COOKIE_NAME);
}

async function setReauthenticationMarker(
  identity: FounderIdentity,
  nowMs: number,
): Promise<void> {
  let marker: string;
  try {
    marker = createReauthenticationMarker({
      accessIdentity: {
        issuedAt: identity.accessIssuedAt,
        subject: identity.accessSubject,
        tokenFingerprint: identity.accessTokenFingerprint,
      },
      initiatedAtMs: nowMs,
      secret: readAdminSessionSecret(),
      sessionId: identity.sessionId,
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge: ADMIN_REAUTHENTICATION_COOKIE_MAX_AGE_SECONDS,
    name: ADMIN_REAUTHENTICATION_COOKIE_NAME,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    value: marker,
  });
}

export async function beginAdminReauthentication(
  identity: FounderIdentity,
  nowMs = Date.now(),
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_ACTIVITY_COOKIE_NAME);
  await setReauthenticationMarker(identity, nowMs);
}

export async function unlockAdminSession(
  identity: FounderIdentity,
  nowMs = Date.now(),
): Promise<AdminUnlockDecision> {
  const cookieStore = await cookies();
  const markerToken = cookieStore.get(
    ADMIN_REAUTHENTICATION_COOKIE_NAME,
  )?.value;
  const secret = readAdminSessionSecret();

  if (markerToken) {
    let marker;
    try {
      marker = verifyReauthenticationMarker({
        accessSubject: identity.accessSubject,
        nowMs,
        secret,
        sessionId: identity.sessionId,
        token: markerToken,
      });
    } catch {
      throw new AdminAccessError("configuration-invalid");
    }

    if (marker.valid) {
      const replacement = evaluateReplacementAccessIdentity({
        marker,
        nowMs,
        replacementIdentity: {
          issuedAt: identity.accessIssuedAt,
          subject: identity.accessSubject,
          tokenFingerprint: identity.accessTokenFingerprint,
        },
      });
      if (replacement.accepted) {
        await setAdminActivity(identity, nowMs);
        cookieStore.delete(ADMIN_REAUTHENTICATION_COOKIE_NAME);
        return { unlocked: true };
      }

      return {
        logoutPath: CLOUDFLARE_ACCESS_LOGOUT_PATH,
        reauthenticationRequired: true,
        unlocked: false,
      };
    }

    cookieStore.delete(ADMIN_REAUTHENTICATION_COOKIE_NAME);
  }

  // A missing marker is never treated as first-entry proof. This prevents a
  // direct unlock request or deletion of app cookies from bypassing the
  // required Access logout -> new-token transition.
  await beginAdminReauthentication(identity, nowMs);
  return {
    logoutPath: CLOUDFLARE_ACCESS_LOGOUT_PATH,
    reauthenticationRequired: true,
    unlocked: false,
  };
}

/**
 * Clears the shared activity cookie only when the server-side activity record
 * is already invalid or expired. A stale background tab cannot lock a session
 * that another tab has refreshed.
 */
export async function lockAdminActivityIfInactive(
  identity: FounderIdentity,
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
      accessSubject: identity.accessSubject,
      secret: readAdminSessionSecret(),
      sessionId: identity.sessionId,
      token,
    });
  } catch {
    throw new AdminAccessError("configuration-invalid");
  }

  if (
    verification.valid &&
    identity.accessIssuedAt >= verification.minimumAccessIssuedAtSec
  ) {
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
