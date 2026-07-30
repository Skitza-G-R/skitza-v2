import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  assertSongArtworkUploadMetadata,
  normalizeSongArtworkFileName,
  type SongArtworkContentType,
} from "./policy";

const TOKEN_DOMAIN = "skitza:private-song-artwork:v1";
const MAX_TOKEN_LENGTH = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SONG_ARTWORK_UPLOAD_TTL_SECONDS = 10 * 60;

export class SongArtworkTokenError extends Error {
  constructor() {
    super("Song artwork upload was not found");
    this.name = "SongArtworkTokenError";
  }
}

export type SongArtworkUploadTokenPayload = Readonly<{
  version: 1;
  kind: "song_artwork_upload";
  uploadId: string;
  baseRevision: string;
  producerId: string;
  trackId: string;
  originalFileName: string;
  contentType: SongArtworkContentType;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
}>;

function tokenError(): never {
  throw new SongArtworkTokenError();
}

function signingKey(serverSecret: string): Buffer {
  if (typeof serverSecret !== "string" || serverSecret.length < 20) {
    throw new Error("Song artwork uploads require the configured server auth secret");
  }
  return createHmac("sha256", serverSecret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function sign(serverSecret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    tokenError();
  }
}

function assertPayload(value: unknown): SongArtworkUploadTokenPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    tokenError();
  }
  const payload = value as Record<string, unknown>;
  assertExactKeys(payload, [
    "version",
    "kind",
    "uploadId",
    "baseRevision",
    "producerId",
    "trackId",
    "originalFileName",
    "contentType",
    "sizeBytes",
    "expiresAtEpochSeconds",
  ]);
  if (
    payload.version !== 1 ||
    payload.kind !== "song_artwork_upload" ||
    typeof payload.uploadId !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.uploadId) ||
    typeof payload.baseRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.baseRevision) ||
    typeof payload.producerId !== "string" ||
    !UUID.test(payload.producerId) ||
    typeof payload.trackId !== "string" ||
    !UUID.test(payload.trackId) ||
    typeof payload.originalFileName !== "string" ||
    typeof payload.contentType !== "string" ||
    typeof payload.sizeBytes !== "number" ||
    !Number.isSafeInteger(payload.expiresAtEpochSeconds) ||
    (payload.expiresAtEpochSeconds as number) <= 0
  ) {
    tokenError();
  }
  try {
    const originalFileName = normalizeSongArtworkFileName(payload.originalFileName);
    assertSongArtworkUploadMetadata({
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
    });
    return Object.freeze({
      version: 1,
      kind: "song_artwork_upload",
      uploadId: payload.uploadId,
      baseRevision: payload.baseRevision,
      producerId: payload.producerId.toLowerCase(),
      trackId: payload.trackId.toLowerCase(),
      originalFileName,
      contentType: payload.contentType as SongArtworkContentType,
      sizeBytes: payload.sizeBytes,
      expiresAtEpochSeconds: payload.expiresAtEpochSeconds as number,
    });
  } catch {
    tokenError();
  }
}

function canonicalPayload(payload: SongArtworkUploadTokenPayload): string {
  return JSON.stringify({
    version: 1,
    kind: "song_artwork_upload",
    uploadId: payload.uploadId,
    baseRevision: payload.baseRevision,
    producerId: payload.producerId,
    trackId: payload.trackId,
    originalFileName: payload.originalFileName,
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

function signToken(serverSecret: string, payloadValue: SongArtworkUploadTokenPayload): string {
  const payload = assertPayload(payloadValue);
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(serverSecret, encodedPayload).toString("base64url")}`;
}

export function createSongArtworkUploadToken(
  serverSecret: string,
  input: Omit<
    SongArtworkUploadTokenPayload,
    "version" | "kind" | "uploadId" | "expiresAtEpochSeconds"
  >,
  now = new Date(),
): { token: string; payload: SongArtworkUploadTokenPayload } {
  if (Number.isNaN(now.getTime())) tokenError();
  const payload = assertPayload({
    version: 1,
    kind: "song_artwork_upload",
    uploadId: randomBytes(32).toString("hex"),
    ...input,
    expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + SONG_ARTWORK_UPLOAD_TTL_SECONDS,
  });
  return { token: signToken(serverSecret, payload), payload };
}

export function verifySongArtworkUploadToken(
  serverSecret: string,
  token: string,
  now = new Date(),
): SongArtworkUploadTokenPayload {
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
  if (payload.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) {
    tokenError();
  }
  return payload;
}

export function verifyOwnedSongArtworkUploadToken(
  serverSecret: string,
  token: string,
  expected: Readonly<{ producerId: string; trackId: string }>,
  now = new Date(),
): SongArtworkUploadTokenPayload {
  const payload = verifySongArtworkUploadToken(serverSecret, token, now);
  if (
    payload.producerId !== expected.producerId.toLowerCase() ||
    payload.trackId !== expected.trackId.toLowerCase()
  ) {
    tokenError();
  }
  return payload;
}

export type SongArtworkRevisionIdentity = Readonly<{
  storageKey: string;
  contentType: SongArtworkContentType;
  sizeBytes: number;
  objectEtag: string;
}> | null;

/**
 * Opaque compare-and-swap revision. The signed token can prove what artwork
 * was current at prepare time without exposing the private R2 identity.
 */
export function songArtworkRevisionFingerprint(
  serverSecret: string,
  identity: SongArtworkRevisionIdentity,
): string {
  const canonical =
    identity === null
      ? "none"
      : JSON.stringify({
          storageKey: identity.storageKey,
          contentType: identity.contentType,
          sizeBytes: identity.sizeBytes,
          objectEtag: identity.objectEtag,
        });
  return createHmac("sha256", signingKey(serverSecret))
    .update(`${TOKEN_DOMAIN}:revision\0${canonical}`, "utf8")
    .digest("hex");
}

/**
 * Server-only key derivation. Staging is deterministic per song so abandoned
 * uploads are bounded to one private object. Final objects are immutable and
 * unique per signed attempt.
 */
export function songArtworkObjectKeys(
  serverSecret: string,
  payload: Pick<SongArtworkUploadTokenPayload, "producerId" | "trackId" | "uploadId">,
): { stagingKey: string; finalKey: string } {
  if (
    !UUID.test(payload.producerId) ||
    !UUID.test(payload.trackId) ||
    !/^[a-f0-9]{64}$/.test(payload.uploadId)
  ) {
    tokenError();
  }
  const key = signingKey(serverSecret);
  const opaque = (purpose: string, value: string) =>
    createHmac("sha256", key)
      .update(`${TOKEN_DOMAIN}:object:${purpose}\0${value}`, "utf8")
      .digest("hex");
  const trackScope = `${payload.producerId.toLowerCase()}\0${payload.trackId.toLowerCase()}`;
  return {
    stagingKey: `song-artwork-staging/${opaque("staging", trackScope)}`,
    finalKey: `song-artwork/${opaque("final", payload.uploadId)}`,
  };
}
