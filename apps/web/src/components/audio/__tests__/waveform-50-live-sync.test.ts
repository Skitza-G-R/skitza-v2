import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { pickWaveformTime } from "../waveform-50";

// Waveform50 must sync its playhead with the global PersistentPlayer
// when the version it's rendering is the one currently playing in the
// dock. Otherwise the big song-page waveform stays stuck at 0:00 while
// the dock advances — exactly what the founder reported on the v3
// preview ("the big bar is not in sync with the music").

// ─── pickWaveformTime — pure helper ──────────────────────────────────

describe("pickWaveformTime — chooses live vs internal time source", () => {
  it("returns liveMs when the active version is currently playing in the dock", () => {
    expect(pickWaveformTime({ isLive: true, liveMs: 12_345, internalMs: 0 })).toBe(12_345);
  });

  it("returns internalMs when this version is NOT the live track", () => {
    expect(pickWaveformTime({ isLive: false, liveMs: 99_000, internalMs: 5_000 })).toBe(5_000);
  });

  it("clamps non-finite live time to internalMs (HLS Infinity guard)", () => {
    expect(pickWaveformTime({ isLive: true, liveMs: Number.NaN, internalMs: 0 })).toBe(0);
    expect(pickWaveformTime({ isLive: true, liveMs: Number.POSITIVE_INFINITY, internalMs: 5_000 })).toBe(5_000);
  });
});

// ─── Source-grep — wire-up ───────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const WAVEFORM_PATH = join(here, "..", "waveform-50.tsx");
const waveformSrc = readFileSync(WAVEFORM_PATH, "utf8");

describe("waveform-50.tsx source — wired to PersistentPlayer", () => {
  it("imports useNowPlaying, playerSeek, PLAYER_EVENTS from persistent-player", () => {
    expect(waveformSrc).toMatch(/from\s+["']\.\/persistent-player["']/);
    expect(waveformSrc).toContain("useNowPlaying");
    expect(waveformSrc).toContain("playerSeek");
    expect(waveformSrc).toContain("PLAYER_EVENTS");
  });

  it("subscribes to PLAYER_EVENTS.time so playback advances the playhead", () => {
    // The player broadcasts current ms via `skitza:player:time` on every
    // <audio> timeupdate. Without this listener the waveform never moves
    // during playback (the bug we're fixing).
    expect(waveformSrc).toContain("PLAYER_EVENTS.time");
    expect(waveformSrc).toMatch(/addEventListener\(\s*PLAYER_EVENTS\.time/);
  });

  it("dispatches playerSeek on click/drag when this version is live (so dock + bar stay aligned)", () => {
    // When the producer scrubs the big waveform of the version that's
    // playing, it must seek the dock's <audio> too — otherwise the dock
    // keeps advancing from where it was while the visual jumps.
    expect(waveformSrc).toContain("playerSeek(");
  });

  it("uses pickWaveformTime to choose the rendered playhead source", () => {
    expect(waveformSrc).toContain("pickWaveformTime(");
  });
});

// Pre-computed peaks ride down with the page payload via the new
// initialPeaks prop. When present, Waveform50 must render the real
// envelope on first frame and skip the client-side decode entirely.
// When absent (legacy versions before the migration), it falls back
// to the existing peaksUrl decode path.
describe("waveform-50.tsx source — accepts pre-computed initialPeaks", () => {
  it("declares initialPeaks as an optional prop on Waveform50Props", () => {
    expect(waveformSrc).toMatch(/initialPeaks\?:\s*number\[\]/);
  });

  it("imports the shared rmsPeaks math from ~/lib/audio/rms-peaks", () => {
    // The math must be shared so server-pre-computed peaks render
    // bit-identical to client-decoded peaks (no envelope jump when
    // the backfill lands).
    expect(waveformSrc).toMatch(/from\s+["']~\/lib\/audio\/rms-peaks["']/);
  });

  it("prefers initialPeaks over the client decode (avoids redundant fetch + decode)", () => {
    // When initialPeaks is present, the decodeUrl passed to
    // useAudioPeaks must short to null — otherwise we'd burn a fetch
    // + Web Audio decode on every view even though the array is
    // already in hand.
    expect(waveformSrc).toContain("hasInitialPeaks");
    expect(waveformSrc).toMatch(/decodeUrl\s*=\s*hasInitialPeaks\s*\?\s*null/);
  });

  it("falls back to peaksUrl decode when initialPeaks is null/missing", () => {
    // The fallback path is what keeps legacy versions (peaks=null in
    // DB) usable until the backfill script populates them.
    expect(waveformSrc).toContain("useAudioPeaks");
  });
});
