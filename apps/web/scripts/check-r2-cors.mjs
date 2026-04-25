#!/usr/bin/env node
// No-creds R2 CORS health check. Hits the bucket's OPTIONS preflight
// the same way a browser does before a presigned-URL PUT. Asserts:
//   - HTTP 200
//   - Access-Control-Allow-Origin matches the requesting Origin
//   - Access-Control-Expose-Headers includes ETag (required for multipart)
//
// Why it exists:
// On 2026-04-23 the audio bucket was missing its CORS policy and every
// upload broke with "Failed to fetch (skitza-audio.<account>.r2…)". We
// re-applied via apply-r2-cors.mjs (audit Task 19). On 2026-04-26 it
// happened AGAIN — same symptom, same fix. Without a detection script
// we only learn about it when a producer tries to upload and fails.
//
// This script is the detection. Run it locally any time, or wire it
// into a periodic check (CI on a schedule, uptime probe, etc.) so the
// next regression triggers an alert instead of a user complaint.
//
// Exits 0 on success, non-zero on any check failure. No creds needed
// — uses publicly observable preflight semantics, same as a browser.
//
// Usage:
//   node apps/web/scripts/check-r2-cors.mjs
//   node apps/web/scripts/check-r2-cors.mjs --bucket skitza-docs
//   node apps/web/scripts/check-r2-cors.mjs --account 38eae08b9d1c0a37909bcd06c6b0ea16
//
// Env (optional — falls back to known prod values if unset):
//   R2_ACCOUNT_ID    — account id portion of the R2 endpoint
//   R2_BUCKET_AUDIO  — defaults to skitza-audio
//   R2_BUCKET_DOCS   — defaults to skitza-docs

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

// We hard-code the prod account id as a fallback so the script is
// runnable from anywhere (CI, a fresh clone, a non-Vercel laptop)
// without env setup. The account id is not a secret — it's part of
// every public R2 endpoint URL the browser already knows about.
const ACCOUNT_ID =
  flag("account") ??
  process.env.R2_ACCOUNT_ID ??
  "38eae08b9d1c0a37909bcd06c6b0ea16";

const BUCKETS = flag("bucket")
  ? [flag("bucket")]
  : [
      process.env.R2_BUCKET_AUDIO ?? "skitza-audio",
      process.env.R2_BUCKET_DOCS ?? "skitza-docs",
    ];

// Origins the live policy must accept. Must match
// apps/web/src/server/storage/r2-cors.ts and apply-r2-cors.mjs.
const REQUIRED_ORIGINS = ["https://skitza.app"];

const REQUIRED_EXPOSED_HEADERS = ["etag"]; // case-insensitive compare

let failures = 0;

async function checkBucket(bucket) {
  const url = `https://${bucket}.${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  process.stdout.write(`→ ${bucket} ... `);

  for (const origin of REQUIRED_ORIGINS) {
    let resp;
    try {
      resp = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      });
    } catch (err) {
      console.log(`❌ network error: ${err.message}`);
      failures++;
      return;
    }

    if (resp.status !== 200) {
      console.log(`❌ HTTP ${resp.status} for Origin ${origin}`);
      const body = await resp.text().catch(() => "");
      if (body) console.log(`   body: ${body.slice(0, 200)}`);
      failures++;
      return;
    }

    const acao = resp.headers.get("access-control-allow-origin");
    if (acao !== origin && acao !== "*") {
      console.log(`❌ Access-Control-Allow-Origin = ${acao ?? "(missing)"}, expected ${origin}`);
      failures++;
      return;
    }

    const exposed = (resp.headers.get("access-control-expose-headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim());

    for (const required of REQUIRED_EXPOSED_HEADERS) {
      if (!exposed.includes(required.toLowerCase())) {
        console.log(`❌ Access-Control-Expose-Headers missing "${required}" — got: ${exposed.join(", ") || "(empty)"}`);
        failures++;
        return;
      }
    }
  }

  console.log("✅");
}

async function main() {
  console.log(`R2 CORS health check (account ${ACCOUNT_ID.slice(0, 8)}…)`);
  for (const bucket of BUCKETS) {
    await checkBucket(bucket);
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} check(s) failed.`);
    console.log("To fix: run `node apps/web/scripts/apply-r2-cors.mjs` with prod env vars sourced.");
    process.exit(1);
  }

  console.log("\n✓ All buckets have correct CORS policy applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
