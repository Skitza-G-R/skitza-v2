// Song-page time helpers. Pure, no React imports — tested by
// __tests__/song-time.test.ts. Mirrors the mockup's fmtTime: floor
// seconds, format as "M:SS" with leading-zero seconds. Negative inputs
// clamp to 0.

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function fmtTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function progressFromSec(sec: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return clamp(sec / durationSec, 0, 1);
}

export function secFromProgress(progress: number, durationSec: number): number {
  return clamp(progress, 0, 1) * Math.max(0, durationSec);
}
