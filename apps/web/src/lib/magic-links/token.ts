import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Thrown when a magic-link token cannot be trusted: bad signature, expired,
 * malformed, or the server's MAGIC_LINK_SECRET is missing/invalid. Callers
 * should treat every variant the same way (reject the request, return 401).
 */
export class MagicTokenInvalid extends Error {
  public override readonly name = "MagicTokenInvalid";
}

export interface IssueMagicTokenInput {
  producerId: string;
  target: string;
  ttlSeconds: number;
  /** Optional opaque payload for booking/portfolio context. */
  context?: unknown;
}

export interface MagicTokenPayload {
  producerId: string;
  target: string;
  exp: number;
  context?: unknown;
}

const MIN_SECRET_HEX_CHARS = 32;

function loadKey(): Buffer {
  const secret = process.env.MAGIC_LINK_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_HEX_CHARS) {
    throw new MagicTokenInvalid("MAGIC_LINK_SECRET is missing or too short");
  }
  if (!/^[0-9a-fA-F]+$/.test(secret) || secret.length % 2 !== 0) {
    throw new MagicTokenInvalid("MAGIC_LINK_SECRET must be hex-encoded");
  }
  return Buffer.from(secret, "hex");
}

function sign(encodedPayload: string, key: Buffer): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

function isMagicTokenPayload(value: unknown): value is MagicTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["producerId"] === "string" &&
    typeof v["target"] === "string" &&
    typeof v["exp"] === "number" &&
    Number.isFinite(v["exp"])
  );
}

export function issueMagicToken(input: IssueMagicTokenInput): string {
  const key = loadKey();
  const exp = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  const payload: MagicTokenPayload = {
    producerId: input.producerId,
    target: input.target,
    exp,
    ...(input.context === undefined ? {} : { context: input.context }),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, key);
  return `${encodedPayload}.${signature}`;
}

export function verifyMagicToken(token: string): MagicTokenPayload {
  const key = loadKey();
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new MagicTokenInvalid("malformed token");
  }
  const encodedPayload = parts[0];
  const providedSignature = parts[1];
  if (
    encodedPayload === undefined ||
    providedSignature === undefined ||
    encodedPayload.length === 0 ||
    providedSignature.length === 0
  ) {
    throw new MagicTokenInvalid("malformed token");
  }

  const expectedSignature = sign(encodedPayload, key);
  const expectedBuf = Buffer.from(expectedSignature, "base64url");
  const providedBuf = Buffer.from(providedSignature, "base64url");
  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new MagicTokenInvalid("signature mismatch");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new MagicTokenInvalid("payload is not valid JSON");
  }
  if (!isMagicTokenPayload(parsed)) {
    throw new MagicTokenInvalid("payload shape is invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSeconds) {
    throw new MagicTokenInvalid("token expired");
  }

  return parsed;
}
