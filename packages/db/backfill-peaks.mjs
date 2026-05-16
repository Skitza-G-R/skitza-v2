// Backfill waveform peaks for track_versions rows whose `peaks` column
// is still NULL. After migration 0015 lands, new uploads compute peaks
// at audio.completeMultipart time — but every row created before the
// migration has peaks=null and would still hit the slow client-side
// decodeAudioData round-trip on every viewer's machine. This one-shot
// script fixes them all in one pass.
//
// Usage:
//   DATABASE_URL=postgres://... node packages/db/backfill-peaks.mjs
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

import { neon } from "@neondatabase/serverless";
import decode from "audio-decode";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

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

async function computePeaks(url) {
  let bytes;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`    fetch ${res.status} for ${url}`);
      return null;
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    console.warn(`    fetch failed: ${err.message}`);
    return null;
  }
  try {
    const audio = await decode(bytes);
    const mono = audio.channelData[0];
    if (!mono || mono.length === 0) return null;
    return roundPeaks(rmsPeaks(mono, BAR_COUNT));
  } catch (err) {
    console.warn(`    decode failed: ${err.message}`);
    return null;
  }
}

const rows = await sql`
  SELECT id, audio_url
    FROM track_versions
   WHERE peaks IS NULL
     AND audio_url IS NOT NULL
   ORDER BY uploaded_at DESC
`;

console.log(`${rows.length} version(s) to backfill.`);

let ok = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  console.log(`\n→ ${row.id}`);
  console.log(`  ${row.audio_url}`);
  const peaks = await computePeaks(row.audio_url);
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
