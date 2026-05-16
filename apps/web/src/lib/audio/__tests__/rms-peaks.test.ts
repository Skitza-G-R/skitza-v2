import { describe, expect, it } from "vitest";

import { BAR_COUNT, roundPeaks, rmsPeaks } from "../rms-peaks";

// Pure peaks math runs on both server (audio.completeMultipart) and
// client (Waveform50.useAudioPeaks). The contract must stay identical
// so backfilled rows render bit-identical to legacy client-decoded
// rows — otherwise a producer would see the envelope visibly shift
// the moment the backfill landed.

describe("rmsPeaks — RMS-block reduction over a PCM signal", () => {
  it("returns an array of barCount entries", () => {
    const data = new Float32Array(1_000).fill(0.5);
    expect(rmsPeaks(data, 50)).toHaveLength(50);
  });

  it("returns an empty array for empty input", () => {
    expect(rmsPeaks(new Float32Array(0), 200)).toEqual([]);
  });

  it("returns an empty array for non-positive bar count", () => {
    expect(rmsPeaks(new Float32Array(100).fill(0.5), 0)).toEqual([]);
    expect(rmsPeaks(new Float32Array(100).fill(0.5), -1)).toEqual([]);
  });

  it("normalizes flat-amplitude input to ~1 across all bars", () => {
    // Constant-amplitude signal: every RMS block computes the same
    // value, the divide-by-max normalization sends them all to 1.
    const data = new Float32Array(2_000).fill(0.42);
    const peaks = rmsPeaks(data, 100);
    expect(peaks).toHaveLength(100);
    for (const p of peaks) {
      expect(p).toBeCloseTo(1, 5);
    }
  });

  it("floors silent sections at 0.06 (matches Waveform50 seeded fallback)", () => {
    // Half-silence, half-amplitude. The silent half should clamp at
    // 0.06 even though its raw RMS is 0 — keeps silent passages from
    // visually dying.
    const data = new Float32Array(1_000);
    for (let i = 500; i < 1_000; i += 1) data[i] = 0.5;
    const peaks = rmsPeaks(data, 10);
    expect(peaks[0]).toBeCloseTo(0.06, 5);
    expect(peaks[9]).toBeCloseTo(1, 5);
  });

  it("clamps any peak above 1 down to 1 (defensive — divide-by-max should already)", () => {
    const data = new Float32Array(2_000);
    for (let i = 0; i < 2_000; i += 1) data[i] = i % 2 === 0 ? 1 : -1;
    const peaks = rmsPeaks(data, 20);
    for (const p of peaks) {
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("roundPeaks — wire-size compression", () => {
  it("rounds each peak to the requested number of decimal places", () => {
    expect(roundPeaks([0.123456789, 0.5, 0.987654321], 4)).toEqual([
      0.1235,
      0.5,
      0.9877,
    ]);
  });

  it("defaults to 4 decimals (~6 chars per peak * 200 bars = ~1.2KB JSON)", () => {
    const out = roundPeaks([0.123456789]);
    expect(out[0]).toBe(0.1235);
  });

  it("never inflates magnitude beyond input range", () => {
    const rounded = roundPeaks([0, 0.5, 1], 4);
    expect(rounded[0]).toBe(0);
    expect(rounded[2]).toBe(1);
  });

  it("returns an empty array for empty input", () => {
    expect(roundPeaks([], 4)).toEqual([]);
  });
});

describe("BAR_COUNT — shared constant", () => {
  it("matches the L3 song page envelope density (200 bars)", () => {
    // Pinned: if anyone changes BAR_COUNT the schema migration's column
    // size assumption + the backfill script's row size estimate move
    // together. Two callers (Waveform50 + server peaks helper) read
    // from this constant.
    expect(BAR_COUNT).toBe(200);
  });
});
