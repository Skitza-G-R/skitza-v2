import { createHmac, timingSafeEqual } from "node:crypto";

import { SongSpaceDomainError } from "./service";

const TOKEN_DOMAIN = "skitza:no-charge-song-space-proposal:v1";
const TOKEN_VERSION = 1 as const;
const TOKEN_KIND = "no_charge_song_space" as const;
const MAX_TOKEN_LENGTH = 4096;

export type NoChargeProposalPayload = Readonly<{
  version: 1;
  kind: "no_charge_song_space";
  producerId: string;
  projectId: string;
  clientContactId: string;
  sourceProductId: string;
  songTitle: string;
  projectTitle: string;
  sourceProductName: string;
  snapshotDigest: string;
  nonce: string;
}>;

function tokenError(): never {
  // Invalid signatures and invalid ownership both map to NOT_FOUND so a
  // caller cannot use the proposal boundary as an identifier oracle.
  throw new SongSpaceDomainError("NOT_FOUND", "No-charge proposal was not found");
}

function requiredString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    value.length <= maximum
  );
}

function assertPayload(value: unknown): NoChargeProposalPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) tokenError();
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = [
    "clientContactId",
    "kind",
    "nonce",
    "producerId",
    "projectId",
    "projectTitle",
    "snapshotDigest",
    "songTitle",
    "sourceProductId",
    "sourceProductName",
    "version",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    tokenError();
  }
  if (
    payload.version !== TOKEN_VERSION ||
    payload.kind !== TOKEN_KIND ||
    !requiredString(payload.producerId, 100) ||
    !requiredString(payload.projectId, 100) ||
    !requiredString(payload.clientContactId, 100) ||
    !requiredString(payload.sourceProductId, 100) ||
    !requiredString(payload.songTitle, 120) ||
    !requiredString(payload.projectTitle, 120) ||
    !requiredString(payload.sourceProductName, 200) ||
    typeof payload.snapshotDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.snapshotDigest) ||
    typeof payload.nonce !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.nonce)
  ) {
    tokenError();
  }
  return {
    version: TOKEN_VERSION,
    kind: TOKEN_KIND,
    producerId: payload.producerId,
    projectId: payload.projectId,
    clientContactId: payload.clientContactId,
    sourceProductId: payload.sourceProductId,
    songTitle: payload.songTitle,
    projectTitle: payload.projectTitle,
    sourceProductName: payload.sourceProductName,
    snapshotDigest: payload.snapshotDigest,
    nonce: payload.nonce,
  };
}

function canonicalPayload(payload: NoChargeProposalPayload): string {
  return JSON.stringify({
    version: TOKEN_VERSION,
    kind: TOKEN_KIND,
    producerId: payload.producerId,
    projectId: payload.projectId,
    clientContactId: payload.clientContactId,
    sourceProductId: payload.sourceProductId,
    songTitle: payload.songTitle,
    projectTitle: payload.projectTitle,
    sourceProductName: payload.sourceProductName,
    snapshotDigest: payload.snapshotDigest,
    nonce: payload.nonce,
  });
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("No-charge proposal signing requires the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function signature(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

export function deriveNoChargeProposalNonce(
  serverSecret: string,
  producerId: string,
  operationKey: string,
): string {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}:nonce\0${producerId}\0${operationKey}`, "utf8")
    .digest("hex");
}

export function signNoChargeProposalToken(
  serverSecret: string,
  payloadValue: NoChargeProposalPayload,
): string {
  const payload = assertPayload(payloadValue);
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signature(serverSecret, encodedPayload).toString("base64url")}`;
}

export function verifyNoChargeProposalToken(
  serverSecret: string,
  token: string,
): NoChargeProposalPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    tokenError();
  }
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) tokenError();
  let suppliedSignature: Buffer;
  let decoded: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    tokenError();
  }
  if (suppliedSignature.toString("base64url") !== encodedSignature) {
    tokenError();
  }
  const expectedSignature = signature(serverSecret, encodedPayload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    tokenError();
  }
  const payload = assertPayload(decoded);
  if (Buffer.from(canonicalPayload(payload), "utf8").toString("base64url") !== encodedPayload) {
    tokenError();
  }
  return payload;
}

export function configuredNoChargeProposalSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new Error("CLERK_SECRET_KEY is required for no-charge proposal signing");
  }
  return secret;
}
