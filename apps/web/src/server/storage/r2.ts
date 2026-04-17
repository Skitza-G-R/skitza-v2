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

function sanitize(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\.+/g, "_");
  if (!cleaned || /^_+$/.test(cleaned)) {
    throw new Error("Invalid filename after sanitization");
  }
  return cleaned;
}

export function buildAudioKey(args: { producerId: string; trackVersionId: string; filename: string }) {
  return `producers/${args.producerId}/tracks/${args.trackVersionId}/${sanitize(args.filename)}`;
}

export function buildDocKey(args: { producerId: string; contractId: string; filename: string }) {
  return `producers/${args.producerId}/contracts/${args.contractId}/${sanitize(args.filename)}`;
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
