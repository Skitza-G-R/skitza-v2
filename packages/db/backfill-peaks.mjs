// Backfill waveform peaks for track_versions rows whose `peaks` column
// is still NULL. After migration 0015 lands, new uploads compute peaks
// at audio.completeMultipart time — but every row created before the
// migration has peaks=null and would still hit the slow client-side
// decodeAudioData round-trip on every viewer's machine. This one-shot
// script fixes them all in one pass.
//
// Usage:
//   DATABASE_URL=postgres://... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
//   R2_SECRET_ACCESS_KEY=... node packages/db/backfill-peaks.mjs
//
// Idempotent — only updates rows with peaks IS NULL. Safe to re-run.
// Errors on a single row don't abort the whole batch; they log + skip.
//
// The peaks math is duplicated from apps/web/src/lib/audio/rms-peaks.ts
// rather than imported across the workspace because this script runs
// as plain .mjs (no TS transpile) and reaching into apps/web's TS
// files would require a build step. The pure-function unit test in
// rms-peaks.test.ts pins the canonical version; any drift between
// here and there is a bug to fix.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import decode from "audio-decode";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

const sql = neon(required("DATABASE_URL"));
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});
const audioBucket = process.env.R2_BUCKET_AUDIO ?? "skitza-audio";

const BAR_COUNT = 200;

// Mirror of apps/web/src/lib/audio/rms-peaks.ts#rmsPeaks. Pure JS, no
// dependencies. If you change this, change the TS version too — the
// rms-peaks.test.ts suite pins the canonical behaviour.
function rmsPeaks(data, barCount) {
  if (data.length === 0 || barCount <= 0) return [];
  const blockSize = Math.max(1, Math.floor(data.length / barCount));
  const out = [];
  for (let i = 0; i < barCount; i += 1) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, data.length);
    let sumSq = 0;
    for (let j = start; j < end; j += 1) {
      const v = data[j] ?? 0;
      sumSq += v * v;
    }
    out.push(Math.sqrt(sumSq / Math.max(1, end - start)));
  }
  const max = Math.max(...out, 1e-9);
  return out.map((p) => Math.max(0.06, Math.min(1, p / max)));
}

function roundPeaks(peaks, decimals = 4) {
  const factor = 10 ** decimals;
  return peaks.map((p) => Math.round(p * factor) / factor);
}

async function computePeaks(row) {
  let bytes;
  try {
    const object = await r2.send(
      new GetObjectCommand({
        Bucket: audioBucket,
        Key: row.audio_r2_key,
        IfMatch: row.audio_object_etag,
      }),
    );
    if (
      !object.Body ||
      object.ETag !== row.audio_object_etag ||
      object.ContentLength !== row.size_bytes
    ) {
      console.warn("    authenticated storage identity did not match");
      return null;
    }
    bytes = await object.Body.transformToByteArray();
  } catch (err) {
    console.warn(`    authenticated storage read failed: ${err.message}`);
    return null;
  }
  try {
    const audio = await decode(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const mono = audio.channelData[0];
    if (!mono || mono.length === 0) return null;
    return roundPeaks(rmsPeaks(mono, BAR_COUNT));
  } catch (err) {
    console.warn(`    decode failed: ${err.message}`);
    return null;
  }
}

const rows = await sql`
  SELECT id, audio_r2_key, audio_object_etag, size_bytes::integer AS size_bytes
    FROM track_versions
   WHERE peaks IS NULL
     AND audio_r2_key IS NOT NULL
     AND audio_object_etag IS NOT NULL
     AND size_bytes IS NOT NULL
     AND audio_deleted_at IS NULL
   ORDER BY uploaded_at DESC
`;

console.log(`${rows.length} version(s) to backfill.`);

let ok = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  console.log(`\n→ ${row.id}`);
  const peaks = await computePeaks(row);
  if (!peaks) {
    failed += 1;
    console.log("  ✗ peaks=null (decode failed or empty)");
    continue;
  }
  try {
    // JSONB column — pass the JS array directly, neon serializes it.
    const peaksJson = JSON.stringify(peaks);
    await sql`UPDATE track_versions SET peaks = ${peaksJson}::jsonb WHERE id = ${row.id}`;
    ok += 1;
    console.log(`  ✓ ${peaks.length} bars saved`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ UPDATE failed: ${err.message}`);
  }
}

console.log(
  `\nDone. ${ok} succeeded, ${skipped} skipped, ${failed} failed of ${rows.length} total.`,
);
if (failed > 0) process.exit(1);
