#!/usr/bin/env node
// One-shot script to apply our R2 bucket CORS policy to the two R2
// buckets Skitza uses (`skitza-audio`, `skitza-docs`). Audit Task 19.
//
// Why a script instead of running it on boot:
// - CORS on an R2 bucket is a one-time config, not a runtime concern.
// - Running it on boot would burn a PutBucketCorsCommand on every
//   serverless cold start for no reason.
// - Having it as a script keeps the policy reviewable in git and
//   re-runnable whenever we tweak origins (e.g. add a staging domain).
//
// Usage:
//   set -a && . apps/web/.env.local && set +a
//   node apps/web/scripts/apply-r2-cors.mjs
//
// Idempotent: R2's PutBucketCors replaces the existing policy, so
// re-running just no-ops if the policy is unchanged.

import {
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Mirrors apps/web/src/server/storage/r2-cors.ts. Kept as a literal
// here (rather than importing the TS module) so this script runs
// with plain `node` — no tsx / ts-node dependency.
const CORS_RULES = [
  {
    AllowedOrigins: [
      "https://skitza.app",
      "https://*.vercel.app",
      "http://localhost:3000",
    ],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

const BUCKETS = [
  process.env.R2_BUCKET_AUDIO ?? "skitza-audio",
  process.env.R2_BUCKET_DOCS ?? "skitza-docs",
];

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `❌ Missing required env var: ${name}. Did you source .env.local?`,
    );
    process.exit(1);
  }
  return v;
}

async function main() {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  for (const bucket of BUCKETS) {
    process.stdout.write(`→ Applying CORS to ${bucket} ... `);
    try {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: { CORSRules: CORS_RULES },
        }),
      );
      console.log("✅");
    } catch (err) {
      console.log("❌");
      console.error(err);
      process.exitCode = 1;
    }
  }

  console.log("\nDone. Verify with:");
  console.log(
    "  curl -i -X OPTIONS \\",
  );
  console.log(
    "    \"https://<bucket>.<account>.r2.cloudflarestorage.com/test\" \\",
  );
  console.log(
    "    -H \"Origin: https://skitza.app\" \\",
  );
  console.log("    -H \"Access-Control-Request-Method: PUT\"");
  console.log(
    "  # Expect 200 + Access-Control-Allow-Origin: https://skitza.app",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
