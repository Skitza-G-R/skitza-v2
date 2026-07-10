import { randomBytes } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let _r2: S3Client | null = null;

export function getR2(): S3Client {
  if (_r2) return _r2;
  _r2 = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return _r2;
}

export const BUCKETS = {
  audio: process.env.R2_BUCKET_AUDIO ?? "skitza-audio",
  docs: process.env.R2_BUCKET_DOCS ?? "skitza-docs",
} as const;

// Extract the extension (with leading dot) from a filename, or empty string.
function extractExtension(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m?.[1] ? `.${m[1].toLowerCase()}` : "";
}

// Sanitize a filename for use as an R2 object key suffix.
// Non-ASCII (Hebrew, emoji, Japanese, etc.) can't be represented in the
// ASCII-safe key alphabet, so we fall back to a random hex name that
// preserves the extension — avoids collision on repeat uploads of
// same-named files.
function sanitize(name: string): string {
  const trimmed = name.trim();
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\.+/g, "_");
  const bodyOnly = cleaned.replace(/\.[a-zA-Z0-9]+$/, "");
  if (!cleaned || !bodyOnly || /^_+$/.test(bodyOnly)) {
    const ext = extractExtension(name);
    const rand = randomBytes(4).toString("hex");
    return `track-${rand}${ext}`;
  }
  return cleaned;
}

export function buildAudioKey(args: {
  producerId: string;
  trackVersionId: string;
  filename: string;
}) {
  return `producers/${args.producerId}/tracks/${args.trackVersionId}/${sanitize(args.filename)}`;
}

export function buildDocKey(args: { producerId: string; contractId: string; filename: string }) {
  return `producers/${args.producerId}/contracts/${args.contractId}/${sanitize(args.filename)}`;
}

type ProofPurchaseKeyArgs = {
  producerId: string;
  purchaseRequestId: string;
};

// Artist uploads use one deterministic staging object per purchase. Repeated
// presigns therefore replace the same staging object instead of creating an
// unbounded number of orphaned objects.
export function buildProofStagingKey(args: ProofPurchaseKeyArgs): string {
  return `proof-staging/producers/${args.producerId}/requests/${args.purchaseRequestId}/upload`;
}

// Final proof objects are created by the server after it has validated the
// staged upload. The 16-byte random prefix provides 128 bits of entropy.
export function buildFinalProofKey(
  args: ProofPurchaseKeyArgs & {
    filename: string;
  },
): string {
  const rand = randomBytes(16).toString("hex");
  return `producers/${args.producerId}/proofs/${args.purchaseRequestId}/final/${rand}-${sanitize(args.filename)}`;
}

// Staging ownership is exact: neither a sibling object nor a key with an
// attacker-controlled suffix is accepted for the purchase.
export function isProofStagingKeyForPurchase(key: string, args: ProofPurchaseKeyArgs): boolean {
  return key === buildProofStagingKey(args);
}

function encodeR2PathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// CopySource is an HTTP header, so encode each bucket/key path segment while
// preserving the separators that identify the object path.
export function encodeR2CopySource(bucket: string, key: string): string {
  return [bucket, ...key.split("/")].map(encodeR2PathSegment).join("/");
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

// Content-Type is supplied by the browser and therefore is not evidence of
// the actual file format. Validate a small leading-byte sample before a proof
// is copied to its immutable final key.
export function hasValidProofFileSignature(contentType: string, bytes: Uint8Array): boolean {
  switch (contentType.toLowerCase()) {
    case "image/jpeg":
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "image/heic": {
      if (ascii(bytes, 4, 4) !== "ftyp") return false;
      return new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]).has(ascii(bytes, 8, 4));
    }
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    default:
      return false;
  }
}

// R2 Public Development URLs are bucket-scoped (e.g. https://pub-<id>.r2.dev
// IS the bucket endpoint), so the URL format is `${base}/${key}` — no bucket
// name in the path. `bucket` is kept as a parameter for future use if we ever
// switch to a multi-bucket custom domain (e.g. https://cdn.skitza.com/audio/...).
export function publicUrl(bucket: keyof typeof BUCKETS, key: string) {
  void bucket;
  const base = requireEnv("R2_PUBLIC_BASE").replace(/\/+$/, "");
  return `${base}/${key}`;
}
