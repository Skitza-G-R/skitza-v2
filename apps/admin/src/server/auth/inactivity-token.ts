import { createHmac, timingSafeEqual } from "node:crypto";

export { ADMIN_INACTIVITY_TIMEOUT_MS } from "~/lib/admin-session";
import { ADMIN_INACTIVITY_TIMEOUT_MS } from "~/lib/admin-session";
export const ADMIN_INACTIVITY_TOKEN_VERSION = "v2" as const;

const MINIMUM_SECRET_BYTES = 32;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HMAC_DOMAIN = "skitza.admin.inactivity-token";

export type InactivityTokenVerification =
  | Readonly<{
      valid: true;
      lastActivityAtMs: number;
      minimumAccessIssuedAtSec: number;
    }>
  | Readonly<{
      valid: false;
      reason: "malformed" | "invalid-signature";
    }>;

export type InactivityTimeoutEvaluation =
  | Readonly<{
      locked: false;
      inactiveForMs: number;
      locksAtMs: number;
    }>
  | Readonly<{
      locked: true;
      reason: "expired" | "invalid-time";
    }>;

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error("Admin inactivity token secret is invalid");
  }
}

function assertSessionId(sessionId: string): void {
  if (sessionId.length === 0) {
    throw new Error("Admin session identifier is invalid");
  }
}

function assertAccessSubject(accessSubject: string): void {
  if (accessSubject.length === 0) {
    throw new Error("Cloudflare Access subject is invalid");
  }
}

function assertNonNegativeSafeInteger(value: number, errorMessage: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(errorMessage);
  }
}

function signedContent(
  sessionId: string,
  accessSubject: string,
  lastActivityAtMs: number,
  minimumAccessIssuedAtSec: number,
): string {
  // The NUL-delimited domain is outside the canonical JSON payload so this
  // HMAC cannot be confused with another use of the same secret.
  return `${HMAC_DOMAIN}\0${JSON.stringify([
    ADMIN_INACTIVITY_TOKEN_VERSION,
    sessionId,
    accessSubject,
    lastActivityAtMs,
    minimumAccessIssuedAtSec,
  ])}`;
}

function signatureFor(
  sessionId: string,
  accessSubject: string,
  lastActivityAtMs: number,
  minimumAccessIssuedAtSec: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(
      signedContent(
        sessionId,
        accessSubject,
        lastActivityAtMs,
        minimumAccessIssuedAtSec,
      ),
      "utf8",
    )
    .digest("base64url");
}

/**
 * Creates an opaque activity token. The Clerk session and Cloudflare Access
 * subject participate in the signature but are not embedded in the token.
 * The signed Access issued-at floor lets callers require a newly issued Access
 * assertion after locking without weakening the exact inactivity boundary.
 */
export function createInactivityToken(input: Readonly<{
  sessionId: string;
  accessSubject: string;
  secret: string;
  lastActivityAtMs: number;
  minimumAccessIssuedAtSec: number;
}>): string {
  assertSecret(input.secret);
  assertSessionId(input.sessionId);
  assertAccessSubject(input.accessSubject);
  assertNonNegativeSafeInteger(
    input.lastActivityAtMs,
    "Admin activity timestamp is invalid",
  );
  assertNonNegativeSafeInteger(
    input.minimumAccessIssuedAtSec,
    "Cloudflare Access issued-at floor is invalid",
  );

  const signature = signatureFor(
    input.sessionId,
    input.accessSubject,
    input.lastActivityAtMs,
    input.minimumAccessIssuedAtSec,
    input.secret,
  );
  return [
    ADMIN_INACTIVITY_TOKEN_VERSION,
    String(input.lastActivityAtMs),
    String(input.minimumAccessIssuedAtSec),
    signature,
  ].join(".");
}

/**
 * Verifies token integrity and binds it to the currently authenticated Clerk
 * session and verified Cloudflare Access subject. Signature failures
 * deliberately do not distinguish a changed token from a token presented by
 * a different identity.
 */
export function verifyInactivityToken(input: Readonly<{
  token: string;
  sessionId: string;
  accessSubject: string;
  secret: string;
}>): InactivityTokenVerification {
  assertSecret(input.secret);
  assertSessionId(input.sessionId);
  assertAccessSubject(input.accessSubject);

  const parts = input.token.split(".");
  if (parts.length !== 4) {
    return { valid: false, reason: "malformed" };
  }

  const [
    version,
    rawTimestamp,
    rawMinimumAccessIssuedAtSec,
    providedSignature,
  ] = parts;
  if (
    version !== ADMIN_INACTIVITY_TOKEN_VERSION ||
    !rawTimestamp ||
    !/^(0|[1-9]\d*)$/.test(rawTimestamp) ||
    !rawMinimumAccessIssuedAtSec ||
    !/^(0|[1-9]\d*)$/.test(rawMinimumAccessIssuedAtSec) ||
    !providedSignature ||
    !SHA256_BASE64URL_PATTERN.test(providedSignature)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const lastActivityAtMs = Number(rawTimestamp);
  const minimumAccessIssuedAtSec = Number(rawMinimumAccessIssuedAtSec);
  if (
    !Number.isSafeInteger(lastActivityAtMs) ||
    lastActivityAtMs < 0 ||
    String(lastActivityAtMs) !== rawTimestamp ||
    !Number.isSafeInteger(minimumAccessIssuedAtSec) ||
    minimumAccessIssuedAtSec < 0 ||
    String(minimumAccessIssuedAtSec) !== rawMinimumAccessIssuedAtSec
  ) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signatureFor(
    input.sessionId,
    input.accessSubject,
    lastActivityAtMs,
    minimumAccessIssuedAtSec,
    input.secret,
  );
  const expectedBytes = Buffer.from(expectedSignature, "ascii");
  const providedBytes = Buffer.from(providedSignature, "ascii");

  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return { valid: false, reason: "invalid-signature" };
  }

  return { valid: true, lastActivityAtMs, minimumAccessIssuedAtSec };
}

/**
 * Locks at the exact 30-minute boundary. Invalid or backwards time fails
 * closed so clock or caller errors cannot extend an admin session.
 */
export function evaluateInactivityTimeout(input: Readonly<{
  lastActivityAtMs: number;
  nowMs: number;
}>): InactivityTimeoutEvaluation {
  if (
    !Number.isSafeInteger(input.lastActivityAtMs) ||
    input.lastActivityAtMs < 0 ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < input.lastActivityAtMs
  ) {
    return { locked: true, reason: "invalid-time" };
  }

  const inactiveForMs = input.nowMs - input.lastActivityAtMs;
  if (inactiveForMs >= ADMIN_INACTIVITY_TIMEOUT_MS) {
    return { locked: true, reason: "expired" };
  }

  return {
    locked: false,
    inactiveForMs,
    locksAtMs: input.lastActivityAtMs + ADMIN_INACTIVITY_TIMEOUT_MS,
  };
}
