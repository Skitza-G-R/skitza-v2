"use client";

// Shared real-waveform decode. One module-level cache serves every
// surface that draws an envelope for the same audio file — the L3 hero
// waveform, the floating dock strip, and the full-screen mobile player.
// Whoever renders first pays for the fetch + decode; the rest read the
// cached array, so opening the dock over a song page never decodes the
// same track twice.
//
// Peaks are always cached at BAR_COUNT resolution and resampled down to
// whatever density the caller renders. That keeps the cache key a plain
// URL (no barCount dimension) and keeps every surface visually aligned:
// the dock's 32 bars are a literal downsample of the hero's 200.

import { useEffect, useState } from "react";

import { BAR_COUNT, resampleWaveformHeights, rmsPeaks } from "./rms-peaks";

// Module-level cache. Same URL → same peaks, so we only decode each
// audio file once per session. Cleared on full page reload.
const peaksCache = new Map<string, number[]>();

// In-flight decodes, so two components mounting in the same frame (dock
// + hero on the song page) share a single fetch instead of racing.
const pendingDecodes = new Map<string, Promise<number[] | null>>();

/** Test seam + account-exit hook: drop every cached envelope. */
export function clearAudioPeaksCache(): void {
  peaksCache.clear();
  pendingDecodes.clear();
}

// Lazy singleton AudioContext — created on first decode so SSR doesn't
// trip on `new AudioContext()`. We never play through it, just decode.
let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_audioCtx) return _audioCtx;
  // lib.dom.d.ts types `window.AudioContext` as non-nullable, but it
  // genuinely is undefined in some legacy / Safari preview contexts —
  // cast through `unknown` so ESLint's `no-unnecessary-condition`
  // doesn't trip on the runtime fallback.
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  _audioCtx = new Ctor();
  return _audioCtx;
}

async function decodePeaks(url: string): Promise<number[] | null> {
  const ctx = getAudioContext();
  if (!ctx) {
    console.warn("[waveform peaks] AudioContext unavailable");
    return null;
  }
  // The cookie-based session needs to travel with same-origin
  // fetch. Defaults are 'same-origin' but explicit is safer.
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    console.warn(`[waveform peaks] fetch ${String(res.status)} for ${url}`);
    return null;
  }
  const buf = await res.arrayBuffer();
  // decodeAudioData in older Safari is callback-only; the Promise
  // form throws TypeError. Use the universally-supported callback
  // form wrapped in a Promise so both code paths work.
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    // Some browsers (Safari) detach the buffer on decode; give a
    // fresh copy in case anything else wants the bytes. The
    // returned Promise IS the one we wrap — `void` silences the
    // floating-promise lint since the callbacks settle our outer
    // Promise instead.
    void ctx.decodeAudioData(
      buf.slice(0),
      (decoded) => {
        resolve(decoded);
      },
      (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
  const computed = rmsPeaks(audio.getChannelData(0), BAR_COUNT);
  if (typeof window !== "undefined") {
    // Soft signal for the song page (or anyone curious) to verify
    // peaks landed — listen with:
    //   addEventListener('skitza:waveform:peaks', e => console.log(e.detail))
    window.dispatchEvent(
      new CustomEvent("skitza:waveform:peaks", {
        detail: { url, sampleRate: audio.sampleRate, duration: audio.duration },
      }),
    );
  }
  return computed;
}

/**
 * Fetch + decode `url` into `barCount` peaks. Returns `fallback` until
 * the real envelope resolves, and silently keeps the fallback when the
 * decode fails (offline, unsupported container, revoked access) so a
 * waveform never renders empty.
 *
 * Pass `null` for the URL to opt out entirely — callers that already
 * hold pre-computed peaks should do that rather than burning a fetch.
 */
export function useAudioPeaks(
  url: string | null | undefined,
  barCount: number,
  fallback: number[],
): number[] {
  const [peaks, setPeaks] = useState<number[]>(() => {
    const cached = url ? peaksCache.get(url) : undefined;
    return cached ? resampleWaveformHeights(cached, barCount) : fallback;
  });

  // Keep peaks in sync with seed changes when no URL is provided.
  // (When URL changes, the effect below overrides this with the cache
  // hit or the decode result.)
  useEffect(() => {
    if (!url) {
      setPeaks(fallback);
    }
    // fallback is recomputed per seed by the parent useMemo; safe to
    // depend on its identity.
  }, [url, fallback]);

  useEffect(() => {
    if (!url) return;
    const cached = peaksCache.get(url);
    if (cached) {
      setPeaks(resampleWaveformHeights(cached, barCount));
      return;
    }
    // Object-wrapped flag so ESLint's no-unnecessary-condition can't
    // statically conclude `cancelled` never flips — the cleanup
    // function below mutates `flag.cancelled` after the closure
    // captures it.
    const flag = { cancelled: false };
    const pending =
      pendingDecodes.get(url) ??
      decodePeaks(url)
        .catch((err: unknown) => {
          // Surface the failure so dev tools shows WHY peaks didn't load,
          // but keep the seeded fallback so the UI never breaks.
          console.warn("[waveform peaks] decode failed:", err);
          return null;
        })
        .then((computed) => {
          pendingDecodes.delete(url);
          if (computed) peaksCache.set(url, computed);
          return computed;
        });
    pendingDecodes.set(url, pending);
    void pending.then((computed) => {
      if (flag.cancelled || !computed) return;
      setPeaks(resampleWaveformHeights(computed, barCount));
    });
    return () => {
      flag.cancelled = true;
    };
  }, [url, barCount]);

  return peaks;
}
