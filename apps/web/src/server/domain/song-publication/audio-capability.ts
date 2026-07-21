import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_DOMAIN = "skitza:song-publication:portfolio-audio:v1";
const MAX_TOKEN_LENGTH = 4_096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PORTFOLIO_AUDIO_CAPABILITY_TTL_SECONDS = 4 * 60 * 60;

export class SongPublicAudioCapabilityError extends Error {
  constructor() {
    super("Public audio was not found");
    this.name = "SongPublicAudioCapabilityError";
  }
}

export type PortfolioAudioCapabilityPayload = Readonly<{
  version: 1;
  purpose: "portfolio_audio";
  producerId: string;
  trackId: string;
  versionId: string;
  portfolioPublishedAtEpochMs: number;
  expiresAtEpochSeconds: number;
}>;

function fail(): never {
  throw new SongPublicAudioCapabilityError();
}

function signingKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < 20) {
    throw new Error("Public song audio requires the configured server auth secret");
  }
  return createHmac("sha256", secret).update(`${TOKEN_DOMAIN}:signing-key`).digest();
}

function signature(secret: string, encodedPayload: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`${TOKEN_DOMAIN}\0${encodedPayload}`, "utf8")
    .digest();
}

function payloadShape(value: unknown): PortfolioAudioCapabilityPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    "expiresAtEpochSeconds",
    "portfolioPublishedAtEpochMs",
    "producerId",
    "purpose",
    "trackId",
    "version",
    "versionId",
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    candidate.version !== 1 ||
    candidate.purpose !== "portfolio_audio" ||
    typeof candidate.producerId !== "string" ||
    !UUID.test(candidate.producerId) ||
    typeof candidate.trackId !== "string" ||
    !UUID.test(candidate.trackId) ||
    typeof candidate.versionId !== "string" ||
    !UUID.test(candidate.versionId) ||
    !Number.isSafeInteger(candidate.portfolioPublishedAtEpochMs) ||
    (candidate.portfolioPublishedAtEpochMs as number) <= 0 ||
    !Number.isSafeInteger(candidate.expiresAtEpochSeconds) ||
    (candidate.expiresAtEpochSeconds as number) <= 0
  ) {
    fail();
  }
  return Object.freeze({
    version: 1,
    purpose: "portfolio_audio",
    producerId: candidate.producerId,
    trackId: candidate.trackId,
    versionId: candidate.versionId,
    portfolioPublishedAtEpochMs: candidate.portfolioPublishedAtEpochMs as number,
    expiresAtEpochSeconds: candidate.expiresAtEpochSeconds as number,
  });
}

function canonical(payload: PortfolioAudioCapabilityPayload): string {
  return JSON.stringify({
    version: 1,
    purpose: "portfolio_audio",
    producerId: payload.producerId,
    trackId: payload.trackId,
    versionId: payload.versionId,
    portfolioPublishedAtEpochMs: payload.portfolioPublishedAtEpochMs,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
  });
}

export function createPortfolioAudioCapability(
  secret: string,
  input: Omit<PortfolioAudioCapabilityPayload, "version" | "purpose" | "expiresAtEpochSeconds">,
  now = new Date(),
): string {
  if (Number.isNaN(now.getTime())) throw new Error("Capability time must be valid");
  const payload = payloadShape({
    version: 1,
    purpose: "portfolio_audio",
    ...input,
    expiresAtEpochSeconds:
      Math.floor(now.getTime() / 1_000) + PORTFOLIO_AUDIO_CAPABILITY_TTL_SECONDS,
  });
  const encoded = Buffer.from(canonical(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(secret, encoded).toString("base64url")}`;
}

export function verifyPortfolioAudioCapability(
  secret: string,
  token: string,
  now = new Date(),
): PortfolioAudioCapabilityPayload {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
    Number.isNaN(now.getTime())
  ) {
    fail();
  }
  const [encoded, encodedSignature] = token.split(".");
  if (!encoded || !encodedSignature) fail();

  let supplied: Buffer;
  let decoded: unknown;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail();
  }
  if (supplied.toString("base64url") !== encodedSignature) fail();
  const expected = signature(secret, encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail();

  const payload = payloadShape(decoded);
  if (Buffer.from(canonical(payload), "utf8").toString("base64url") !== encoded) fail();
  if (payload.expiresAtEpochSeconds <= Math.floor(now.getTime() / 1_000)) fail();
  return payload;
}
