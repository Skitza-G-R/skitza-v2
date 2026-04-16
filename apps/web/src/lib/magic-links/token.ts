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

// 64 hex chars = 32 bytes = 256 bits, matching HMAC-SHA256 output length
// per NIST SP 800-107 §5.3.4. Anything shorter underwhelms the primitive.
const MIN_SECRET_HEX_CHARS = 64;

// `verifyMagicToken` runs on unauthenticated requests. Cap input length so
// a large attacker-supplied string can't force expensive base64/JSON work.
// Real tokens fit comfortably under 1 KB; 4 KB leaves headroom for `context`.
const MAX_TOKEN_LENGTH = 4096;

function loadKey(): Buffer {
  const secret = process.env.MAGIC_LINK_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_HEX_CHARS) {
    throw new MagicTokenInvalid(
      `MAGIC_LINK_SECRET must be at least ${String(MIN_SECRET_HEX_CHARS)} hex chars (256 bits)`,
    );
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
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new MagicTokenInvalid("token exceeds maximum length");
  }
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
  // HMAC-SHA256 always returns 32 bytes, so `expectedBuf` is never empty;
  // the length-equality guard is required because `timingSafeEqual` throws
  // on length mismatch (it can't compare in constant time otherwise).
  if (
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
