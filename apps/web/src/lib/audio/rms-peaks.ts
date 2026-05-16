// Pure peaks math, isomorphic (server + client). Lives outside the
// "use client" waveform component so the audio.completeMultipart
// path can compute peaks server-side without pulling React or Web
// Audio into the server bundle. The client decode path (Waveform50's
// useAudioPeaks hook) imports the SAME function, so backfilled peaks
// and live-decoded peaks render bit-identically — a producer who
// uploads before the migration applies sees the same envelope after
// the backfill runs.

/**
 * Reduce a Float32 PCM array to N normalized RMS peaks (0..1).
 * Mono signal expected (caller picks channel 0 of stereo). 200 bars
 * is what the L3 waveform renders.
 *
 * Algorithm: chunk the samples into N equal blocks, RMS each block,
 * divide by the global max to normalize, clamp to [0.06, 1] so silent
 * sections still render as a sliver (matches the seeded fallback's
 * visual rhythm).
 */
export function rmsPeaks(data: Float32Array, barCount: number): number[] {
  if (data.length === 0 || barCount <= 0) return [];
  const blockSize = Math.max(1, Math.floor(data.length / barCount));
  const out: number[] = [];
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

/**
 * Round each peak to N decimal places. The JSONB column stores 200
 * floats per version; 4 decimals (0..1 → e.g. 0.4823) keeps the wire
 * payload under ~1.2KB while staying well below the visual
 * resolution of a 4px-tall bar.
 */
export function roundPeaks(peaks: number[], decimals = 4): number[] {
  const factor = Math.pow(10, decimals);
  return peaks.map((p) => Math.round(p * factor) / factor);
}

/** Default bar count for Skitza waveforms — matches Waveform50's BAR_COUNT. */
export const BAR_COUNT = 200;
