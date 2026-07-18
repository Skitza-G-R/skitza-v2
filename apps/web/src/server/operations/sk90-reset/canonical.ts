import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { stop } from "./errors";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function encodeCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) stop("MANIFEST_INPUT_INVALID");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        stop("MANIFEST_INPUT_INVALID");
      }
    }
    return `[${value.map((entry) => encodeCanonical(entry)).join(",")}]`;
  }

  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) stop("MANIFEST_INPUT_INVALID");
        return `${JSON.stringify(key)}:${encodeCanonical(entry)}`;
      });
    return `{${entries.join(",")}}`;
  }

  stop("MANIFEST_INPUT_INVALID");
}

export function canonicalJson(value: unknown): string {
  return encodeCanonical(value);
}

/** Locale-independent ordering for manifest identities and protected tokens. */
export function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export type Sha256Digest = `sha256:${string}`;
export type ProtectedToken = `hmac-sha256:${string}`;

export function sha256Digest(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function protectValue(key: string, value: string): ProtectedToken {
  if (key.length < 32 || value.length === 0) stop("MANIFEST_INPUT_INVALID");
  return `hmac-sha256:${createHmac("sha256", key).update(value, "utf8").digest("hex")}`;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HMAC_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;

export function isSha256Digest(value: string): value is Sha256Digest {
  return SHA256_PATTERN.test(value);
}

export function isProtectedToken(value: string): value is ProtectedToken {
  return HMAC_PATTERN.test(value);
}

export function assertSha256Digest(value: string): asserts value is Sha256Digest {
  if (!isSha256Digest(value)) stop("FINGERPRINT_INVALID");
}

export function assertProtectedToken(value: string): asserts value is ProtectedToken {
  if (!isProtectedToken(value)) stop("MANIFEST_INPUT_INVALID");
}

/** Constant-time equality for already-sanitized fixed-length digests. */
export function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
