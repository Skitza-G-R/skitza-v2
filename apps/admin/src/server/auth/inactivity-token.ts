import { createHmac, timingSafeEqual } from "node:crypto";

export { ADMIN_INACTIVITY_TIMEOUT_MS } from "~/lib/admin-session";
import { ADMIN_INACTIVITY_TIMEOUT_MS } from "~/lib/admin-session";
export const ADMIN_INACTIVITY_TOKEN_VERSION = "v1" as const;

const MINIMUM_SECRET_BYTES = 32;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type InactivityTokenVerification =
  | Readonly<{
      valid: true;
      lastActivityAtMs: number;
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
  if (sessionId.length === 0 || sessionId.includes("\0")) {
    throw new Error("Admin session identifier is invalid");
  }
}

function assertTimestamp(timestampMs: number): void {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new Error("Admin activity timestamp is invalid");
  }
}

function signedContent(sessionId: string, lastActivityAtMs: number): string {
  return [
    ADMIN_INACTIVITY_TOKEN_VERSION,
    sessionId,
    String(lastActivityAtMs),
  ].join("\n");
}

function signatureFor(
  sessionId: string,
  lastActivityAtMs: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(signedContent(sessionId, lastActivityAtMs), "utf8")
    .digest("base64url");
}

/**
 * Creates an opaque activity token. The Clerk session ID participates in the
 * signature but is not embedded in the token.
 */
export function createInactivityToken(input: Readonly<{
  sessionId: string;
  secret: string;
  lastActivityAtMs: number;
}>): string {
  assertSecret(input.secret);
  assertSessionId(input.sessionId);
  assertTimestamp(input.lastActivityAtMs);

  const signature = signatureFor(
    input.sessionId,
    input.lastActivityAtMs,
    input.secret,
  );
  return [
    ADMIN_INACTIVITY_TOKEN_VERSION,
    String(input.lastActivityAtMs),
    signature,
  ].join(".");
}

/**
 * Verifies token integrity and binds it to the currently authenticated Clerk
 * session. Signature failures deliberately do not distinguish a changed token
 * from a token presented by a different session.
 */
export function verifyInactivityToken(input: Readonly<{
  token: string;
  sessionId: string;
  secret: string;
}>): InactivityTokenVerification {
  assertSecret(input.secret);
  assertSessionId(input.sessionId);

  const parts = input.token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed" };
  }

  const [version, rawTimestamp, providedSignature] = parts;
  if (
    version !== ADMIN_INACTIVITY_TOKEN_VERSION ||
    !rawTimestamp ||
    !/^(0|[1-9]\d*)$/.test(rawTimestamp) ||
    !providedSignature ||
    !SHA256_BASE64URL_PATTERN.test(providedSignature)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const lastActivityAtMs = Number(rawTimestamp);
  if (
    !Number.isSafeInteger(lastActivityAtMs) ||
    lastActivityAtMs < 0 ||
    String(lastActivityAtMs) !== rawTimestamp
  ) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signatureFor(
    input.sessionId,
    lastActivityAtMs,
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

  return { valid: true, lastActivityAtMs };
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
