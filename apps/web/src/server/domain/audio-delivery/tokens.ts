import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_DOMAIN = "skitza:audio-delivery:v1";
const MAX_TOKEN_LENGTH = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Public samples are re-authorized against live DB state on every request, so
// this token only avoids exposing a permanent object URL. Four hours lets an
// already-open portfolio page keep seeking without turning the token permanent.
export const PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export class AudioDeliveryTokenError extends Error {
  constructor() {
    super("Audio delivery was not found");
    this.name = "AudioDeliveryTokenError";
  }
}

export type PublicAudioStreamTokenPayload = Readonly<{
  version: 1;
  purpose: "public_stream";
  producerId: string;
  publicSampleId: string;
  expiresAtEpochSeconds: number;
}>;

function tokenError(): never {
  throw new AudioDeliveryTokenError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Audio delivery tokens require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function sign(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function assertPayload(value: unknown): PublicAudioStreamTokenPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) tokenError();
  const payload = value as Record<string, unknown>;
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = [
    "version",
    "purpose",
    "producerId",
    "publicSampleId",
    "expiresAtEpochSeconds",
  ].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    payload.version !== 1 ||
    payload.purpose !== "public_stream" ||
    !isUuid(payload.producerId) ||
    !isUuid(payload.publicSampleId) ||
    !Number.isSafeInteger(payload.expiresAtEpochSeconds) ||
    (payload.expiresAtEpochSeconds as number) <= 0
  ) {
    tokenError();
  }
  return Object.freeze({
    version: 1,
    purpose: "public_stream",
    producerId: payload.producerId,
    publicSampleId: payload.publicSampleId,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds as number,
  });
}

function canonicalPayload(payload: PublicAudioStreamTokenPayload): string {
  return JSON.stringify({
    version: 1,
    purpose: "public_stream",
    producerId: payload.producerId,
    publicSampleId: payload.publicSampleId,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

function signToken(serverSecret: string, payloadValue: PublicAudioStreamTokenPayload): string {
  const payload = assertPayload(payloadValue);
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(serverSecret, encodedPayload).toString("base64url")}`;
}

function verifyToken(
  serverSecret: string,
  token: string,
  now: Date,
): PublicAudioStreamTokenPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
    Number.isNaN(now.getTime())
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

  if (suppliedSignature.toString("base64url") !== encodedSignature) tokenError();
  const expectedSignature = sign(serverSecret, encodedPayload);
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
  if (payload.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) tokenError();
  return payload;
}

export function createPublicAudioStreamToken(
  serverSecret: string,
  input: Omit<PublicAudioStreamTokenPayload, "version" | "purpose" | "expiresAtEpochSeconds">,
  now = new Date(),
): string {
  return signToken(serverSecret, {
    ...input,
    version: 1,
    purpose: "public_stream",
    expiresAtEpochSeconds:
      Math.floor(now.getTime() / 1_000) + PUBLIC_AUDIO_STREAM_TOKEN_TTL_SECONDS,
  });
}

export function verifyPublicAudioStreamToken(
  serverSecret: string,
  token: string,
  now = new Date(),
): PublicAudioStreamTokenPayload {
  return verifyToken(serverSecret, token, now);
}
