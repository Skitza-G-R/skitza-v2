import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_DOMAIN = "skitza:song-publication:link:v1";
const MAX_TOKEN_LENGTH = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SONG_PUBLIC_PATH_PREFIX = "/listen/";

/** Every malformed, forged, stale-looking, or otherwise unusable token fails identically. */
export class SongPublicTokenError extends Error {
  constructor() {
    super("Public song was not found");
    this.name = "SongPublicTokenError";
  }
}

export type SongPublicTokenPayload = Readonly<{
  version: 1;
  purpose: "song_public_link";
  linkId: string;
  tokenVersion: number;
}>;

function fail(): never {
  throw new SongPublicTokenError();
}

function signingKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < 20) {
    throw new Error("Public song links require the configured server auth secret");
  }
  return createHmac("sha256", secret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function signature(secret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function assertPayload(value: unknown): SongPublicTokenPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const candidate = value as Record<string, unknown>;
  const actualKeys = Object.keys(candidate).sort();
  const expectedKeys = ["linkId", "purpose", "tokenVersion", "version"].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    candidate.version !== 1 ||
    candidate.purpose !== "song_public_link" ||
    typeof candidate.linkId !== "string" ||
    !UUID_PATTERN.test(candidate.linkId) ||
    !Number.isSafeInteger(candidate.tokenVersion) ||
    (candidate.tokenVersion as number) <= 0
  ) {
    fail();
  }
  return Object.freeze({
    version: 1,
    purpose: "song_public_link",
    linkId: candidate.linkId,
    tokenVersion: candidate.tokenVersion as number,
  });
}

function canonicalPayload(payload: SongPublicTokenPayload): string {
  return JSON.stringify({
    version: 1,
    purpose: "song_public_link",
    linkId: payload.linkId,
    tokenVersion: payload.tokenVersion,
  });
}

function assertTokenShape(token: string): readonly [string, string] {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    fail();
  }
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) fail();
  return [encodedPayload, encodedSignature];
}

/** A stable link token. It has no clock expiry; reset/disable is enforced from live state. */
export function createSongPublicToken(
  secret: string,
  input: Readonly<{ linkId: string; tokenVersion: number }>,
): string {
  const payload = assertPayload({
    version: 1,
    purpose: "song_public_link",
    linkId: input.linkId,
    tokenVersion: input.tokenVersion,
  });
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signature(secret, encodedPayload).toString("base64url")}`;
}

/** Verifies the signature and the exact canonical payload encoding. */
export function verifySongPublicToken(secret: string, token: string): SongPublicTokenPayload {
  const [encodedPayload, encodedSignature] = assertTokenShape(token);

  let suppliedSignature: Buffer;
  let decoded: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    fail();
  }

  if (suppliedSignature.toString("base64url") !== encodedSignature) fail();
  const expectedSignature = signature(secret, encodedPayload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    fail();
  }

  const payload = assertPayload(decoded);
  const canonicalEncoding = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  if (canonicalEncoding !== encodedPayload) fail();
  return payload;
}

/** Stable database lookup value. The prefix makes the hash algorithm explicit. */
export function hashSongPublicToken(token: string): string {
  assertTokenShape(token);
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function buildSongPublicPath(token: string): string {
  assertTokenShape(token);
  return `${SONG_PUBLIC_PATH_PREFIX}${token}`;
}
