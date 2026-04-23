import type { CORSRule } from "@aws-sdk/client-s3";

// CORS ruleset for Skitza's Cloudflare R2 buckets (`skitza-audio`,
// `skitza-docs`). Applied via scripts/apply-r2-cors.mjs using
// PutBucketCorsCommand.
//
// Why this exists:
// The browser uploads audio files directly to R2 via presigned URLs
// (see apps/web/src/lib/audio/use-multipart-upload.ts). Without a
// CORS policy on the bucket, the browser's preflight OPTIONS request
// returns 403 and the PUT never fires — the user sees "Failed to
// fetch (skitza-audio.<account>.r2.cloudflarestorage.com)".
//
// Security model:
// CORS here is defense-in-depth, NOT the primary auth layer. Every
// upload is gated by a presigned URL minted by `audio.signPart`
// (producerProcedure, key-prefix-scoped). Even a full-wildcard
// origin can't let an attacker upload — they'd need a valid
// presigned URL. We use a curated origin list anyway because it's
// free visibility.

const ALLOWED_ORIGINS = [
  "https://skitza.app",
  // R2/S3 CORS allows at most one `*` per AllowedOrigin entry — this
  // covers Vercel preview deploys (skitza-v2-web-*.vercel.app) without
  // re-applying the policy every time a preview is minted.
  "https://*.vercel.app",
  // Local dev. Add more ports here if contributors run on 3001/4000/etc.
  "http://localhost:3000",
] as const;

const ALLOWED_METHODS = ["PUT", "GET", "HEAD"] as const;

/**
 * Build the R2 CORS ruleset. Returns an array with a single rule —
 * R2 supports multiple rules but our policy fits in one.
 *
 * Exported as a function (not a const) so the tests can exercise it
 * and so future consumers can parameterize origins without mutating
 * a shared literal.
 */
export function buildR2CorsRules(): CORSRule[] {
  return [
    {
      AllowedOrigins: [...ALLOWED_ORIGINS],
      AllowedMethods: [...ALLOWED_METHODS],
      // "*" lets the browser send arbitrary headers — we need this for
      // the `content-type` that the client sets on the blob, plus the
      // `x-amz-*` headers that the AWS S3 signer may add to the
      // request (signatures, SSE, etc.). Listing them explicitly would
      // drift every time the SDK bumps.
      AllowedHeaders: ["*"],
      // Must expose ETag so `resp.headers.get("etag")` works in the
      // multipart client — we send ETags back to completeMultipart
      // as the part manifest.
      ExposeHeaders: ["ETag"],
      // 1 hour. Short enough that policy edits propagate same-day,
      // long enough that a busy producer uploading 20 parts doesn't
      // trigger 20 preflights.
      MaxAgeSeconds: 3600,
    },
  ];
}
