// Server-side waveform peaks computation.
//
// Called from audio.completeMultipart once the multipart upload
// finalises on R2. Fetches the audio bytes back from R2 (server-to-
// server, no CORS), decodes them with audio-decode (pure JS, supports
// WAV/MP3/FLAC/M4A/AIFF), reduces to 200 normalized RMS bars via the
// shared math, rounds to 4 decimals to keep the JSON wire payload
// under ~1.2KB.
//
// All errors degrade silently: if the decoder can't parse a format or
// the fetch fails, we return null. The L3 song page then falls back
// to the existing client-side decode (Waveform50.peaksUrl), so a
// decode failure here is a perf regression for one viewing, not a
// broken UI.
//
// Why audio-decode (not ffmpeg-static): ffmpeg-static ships a ~50MB
// binary that can bust Vercel's serverless bundle limit (~250MB).
// audio-decode is pure JS, ~few hundred KB, and supports every format
// Skitza accepts at upload time. Tradeoff: no AAC-in-MP4 fallback if
// a producer uploads a weird container — they get the slow client
// decode path on first view, identical to today's behaviour.

import decode from "audio-decode";

import {
  BAR_COUNT,
  rmsPeaks,
  roundPeaks,
} from "~/lib/audio/rms-peaks";

export interface ComputePeaksOptions {
  /** Override the bar count. Defaults to BAR_COUNT (200). */
  barCount?: number;
  /** Round each peak to N decimals before persisting. Default 4. */
  decimals?: number;
}

/**
 * Decode the audio bytes and reduce to a normalized peaks array.
 * Returns null on any failure (unsupported format, malformed file,
 * empty buffer). Callers persist a null column when this returns null
 * — the existing client-side fallback handles rendering.
 */
export async function computePeaksFromBytes(
  bytes: ArrayBuffer | Uint8Array,
  options: ComputePeaksOptions = {},
): Promise<number[] | null> {
  const barCount = options.barCount ?? BAR_COUNT;
  const decimals = options.decimals ?? 4;
  try {
    // audio-decode's whole-file form accepts ArrayBuffer | Uint8Array;
    // we normalize to ArrayBuffer for the broadest decoder coverage.
    const buf = bytes instanceof ArrayBuffer ? bytes : bufferOf(bytes);
    const audio = await decode(buf);
    const mono = audio.channelData[0];
    if (!mono || mono.length === 0) return null;
    const peaks = rmsPeaks(mono, barCount);
    return roundPeaks(peaks, decimals);
  } catch (err) {
    // Single warn line so Vercel logs surface the failure without
    // poisoning the upload response — the call site already returns
    // success and the page degrades to client decode.
    console.warn(
      "[peaks] server decode failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Fetch an audio URL and compute peaks for it. Same-origin / R2
 * public URL only — never user-controlled input. Used by both the
 * inline path in audio.completeMultipart AND the backfill script.
 */
export async function computePeaksFromUrl(
  url: string,
  options: ComputePeaksOptions = {},
): Promise<number[] | null> {
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[peaks] fetch ${String(res.status)} for ${url}`,
      );
      return null;
    }
    bytes = await res.arrayBuffer();
  } catch (err) {
    console.warn(
      "[peaks] fetch failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  return computePeaksFromBytes(bytes, options);
}

// Convert a Uint8Array view into a fresh ArrayBuffer slice — handles
// the typed-array case without leaking the parent buffer when the
// view is offset/sub-length.
function bufferOf(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}
