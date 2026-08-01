import { createHmac, timingSafeEqual } from "node:crypto";

import type { CloudflareAccessIdentity } from "./cloudflare-access";

export const ADMIN_REAUTHENTICATION_MARKER_VERSION = "v1" as const;
export const ADMIN_REAUTHENTICATION_MARKER_TTL_MS = 10 * 60 * 1_000;
export const ADMIN_REAUTHENTICATION_MAX_ACCESS_TOKEN_AGE_MS =
  5 * 60 * 1_000;

const HMAC_DOMAIN = "skitza.admin.reauthentication-marker";
const MINIMUM_SECRET_BYTES = 32;
const MAX_ACCESS_ISSUED_AT_SECONDS = Math.floor(
  Number.MAX_SAFE_INTEGER / 1_000,
);
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ReauthenticationAccessIdentity = Pick<
  CloudflareAccessIdentity,
  "issuedAt" | "subject" | "tokenFingerprint"
>;

export type VerifiedReauthenticationMarker = Readonly<{
  valid: true;
  accessSubject: string;
  initiatedAtMs: number;
  priorAccessIssuedAt: number;
  priorTokenFingerprint: string;
}>;

export type ReauthenticationMarkerVerification =
  | VerifiedReauthenticationMarker
  | Readonly<{
      valid: false;
      reason:
        | "expired"
        | "invalid-signature"
        | "invalid-time"
        | "malformed";
    }>;

export type ReplacementAccessIdentityEvaluation =
  | Readonly<{
      accepted: true;
    }>
  | Readonly<{
      accepted: false;
      reason:
        | "invalid-identity"
        | "invalid-time"
        | "issued-before-initiation"
        | "issued-before-prior-token"
        | "marker-expired"
        | "subject-mismatch"
        | "token-reused"
        | "token-too-old";
    }>;

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error("Admin reauthentication marker secret is invalid");
  }
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error(`Admin ${label} is invalid`);
  }
}

function isTimestampMs(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER - ADMIN_REAUTHENTICATION_MARKER_TTL_MS
  );
}

function isAccessIssuedAt(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ACCESS_ISSUED_AT_SECONDS
  );
}

function assertTimestampMs(value: number): void {
  if (!isTimestampMs(value)) {
    throw new Error("Admin reauthentication timestamp is invalid");
  }
}

function assertAccessIdentity(
  identity: ReauthenticationAccessIdentity,
): void {
  assertIdentifier(identity.subject, "Access subject");
  if (
    !isAccessIssuedAt(identity.issuedAt) ||
    !SHA256_BASE64URL_PATTERN.test(identity.tokenFingerprint)
  ) {
    throw new Error("Admin Access identity is invalid");
  }
}

function signedContent(input: Readonly<{
  sessionId: string;
  accessSubject: string;
  initiatedAtMs: number;
  priorAccessIssuedAt: number;
  priorTokenFingerprint: string;
}>): string {
  return JSON.stringify([
    HMAC_DOMAIN,
    ADMIN_REAUTHENTICATION_MARKER_VERSION,
    input.sessionId,
    input.accessSubject,
    input.initiatedAtMs,
    input.priorAccessIssuedAt,
    input.priorTokenFingerprint,
  ]);
}

function signatureFor(
  input: Readonly<{
    sessionId: string;
    accessSubject: string;
    initiatedAtMs: number;
    priorAccessIssuedAt: number;
    priorTokenFingerprint: string;
  }>,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(signedContent(input), "utf8")
    .digest("base64url");
}

/**
 * Creates an opaque, short-lived marker for a locked admin session. The Clerk
 * session and Access subject participate in the domain-separated HMAC but are
 * deliberately not embedded in the token.
 */
export function createReauthenticationMarker(input: Readonly<{
  sessionId: string;
  accessIdentity: ReauthenticationAccessIdentity;
  initiatedAtMs: number;
  secret: string;
}>): string {
  assertSecret(input.secret);
  assertIdentifier(input.sessionId, "session identifier");
  assertAccessIdentity(input.accessIdentity);
  assertTimestampMs(input.initiatedAtMs);

  const marker = {
    sessionId: input.sessionId,
    accessSubject: input.accessIdentity.subject,
    initiatedAtMs: input.initiatedAtMs,
    priorAccessIssuedAt: input.accessIdentity.issuedAt,
    priorTokenFingerprint: input.accessIdentity.tokenFingerprint,
  };
  const signature = signatureFor(marker, input.secret);

  return [
    ADMIN_REAUTHENTICATION_MARKER_VERSION,
    String(marker.initiatedAtMs),
    String(marker.priorAccessIssuedAt),
    marker.priorTokenFingerprint,
    signature,
  ].join(".");
}

/**
 * Verifies integrity, Clerk-session and Access-subject binding, and the exact
 * ten-minute marker lifetime.
 */
export function verifyReauthenticationMarker(input: Readonly<{
  token: string;
  sessionId: string;
  accessSubject: string;
  secret: string;
  nowMs: number;
}>): ReauthenticationMarkerVerification {
  assertSecret(input.secret);
  assertIdentifier(input.sessionId, "session identifier");
  assertIdentifier(input.accessSubject, "Access subject");

  const parts = input.token.split(".");
  if (parts.length !== 5) {
    return { valid: false, reason: "malformed" };
  }

  const [
    version,
    rawInitiatedAtMs,
    rawPriorAccessIssuedAt,
    priorTokenFingerprint,
    providedSignature,
  ] = parts;
  if (
    version !== ADMIN_REAUTHENTICATION_MARKER_VERSION ||
    !rawInitiatedAtMs ||
    !/^(0|[1-9]\d*)$/.test(rawInitiatedAtMs) ||
    !rawPriorAccessIssuedAt ||
    !/^(0|[1-9]\d*)$/.test(rawPriorAccessIssuedAt) ||
    !priorTokenFingerprint ||
    !SHA256_BASE64URL_PATTERN.test(priorTokenFingerprint) ||
    !providedSignature ||
    !SHA256_BASE64URL_PATTERN.test(providedSignature)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const initiatedAtMs = Number(rawInitiatedAtMs);
  const priorAccessIssuedAt = Number(rawPriorAccessIssuedAt);
  if (
    !isTimestampMs(initiatedAtMs) ||
    String(initiatedAtMs) !== rawInitiatedAtMs ||
    !isAccessIssuedAt(priorAccessIssuedAt) ||
    String(priorAccessIssuedAt) !== rawPriorAccessIssuedAt
  ) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signatureFor(
    {
      sessionId: input.sessionId,
      accessSubject: input.accessSubject,
      initiatedAtMs,
      priorAccessIssuedAt,
      priorTokenFingerprint,
    },
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

  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < initiatedAtMs) {
    return { valid: false, reason: "invalid-time" };
  }
  if (
    input.nowMs - initiatedAtMs >=
    ADMIN_REAUTHENTICATION_MARKER_TTL_MS
  ) {
    return { valid: false, reason: "expired" };
  }

  return {
    valid: true,
    accessSubject: input.accessSubject,
    initiatedAtMs,
    priorAccessIssuedAt,
    priorTokenFingerprint,
  };
}

/**
 * Accepts only a newly issued Access application token for the same founder.
 * The minimum issuance second is rounded up so a token minted before a
 * sub-second lock marker can never be mistaken for post-lock proof.
 */
export function evaluateReplacementAccessIdentity(input: Readonly<{
  marker: VerifiedReauthenticationMarker;
  replacementIdentity: ReauthenticationAccessIdentity;
  nowMs: number;
}>): ReplacementAccessIdentityEvaluation {
  const { marker, replacementIdentity, nowMs } = input;
  if (
    !isTimestampMs(marker.initiatedAtMs) ||
    !isAccessIssuedAt(marker.priorAccessIssuedAt) ||
    !SHA256_BASE64URL_PATTERN.test(marker.priorTokenFingerprint) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < marker.initiatedAtMs
  ) {
    return { accepted: false, reason: "invalid-time" };
  }
  if (
    nowMs - marker.initiatedAtMs >=
    ADMIN_REAUTHENTICATION_MARKER_TTL_MS
  ) {
    return { accepted: false, reason: "marker-expired" };
  }
  if (
    replacementIdentity.subject.length === 0 ||
    replacementIdentity.subject.includes("\0") ||
    !isAccessIssuedAt(replacementIdentity.issuedAt) ||
    !SHA256_BASE64URL_PATTERN.test(
      replacementIdentity.tokenFingerprint,
    )
  ) {
    return { accepted: false, reason: "invalid-identity" };
  }
  if (replacementIdentity.subject !== marker.accessSubject) {
    return { accepted: false, reason: "subject-mismatch" };
  }
  if (
    replacementIdentity.tokenFingerprint ===
    marker.priorTokenFingerprint
  ) {
    return { accepted: false, reason: "token-reused" };
  }
  if (replacementIdentity.issuedAt <= marker.priorAccessIssuedAt) {
    return { accepted: false, reason: "issued-before-prior-token" };
  }

  const replacementIssuedAtMs = replacementIdentity.issuedAt * 1_000;
  if (replacementIssuedAtMs > nowMs) {
    return { accepted: false, reason: "invalid-time" };
  }
  if (
    replacementIdentity.issuedAt <
    Math.ceil(marker.initiatedAtMs / 1_000)
  ) {
    return { accepted: false, reason: "issued-before-initiation" };
  }
  if (
    nowMs - replacementIssuedAtMs >
    ADMIN_REAUTHENTICATION_MAX_ACCESS_TOKEN_AGE_MS
  ) {
    return { accepted: false, reason: "token-too-old" };
  }

  return { accepted: true };
}
