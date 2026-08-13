import { afterEach, describe, expect, it, vi } from "vitest";

import { createGate1ProofRecorder } from "./gate1-proof";

function timing(now: { value: number }) {
  return {
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    getEntriesByType: vi.fn(() => [] as PerformanceEntry[]),
    mark: vi.fn(),
    measure: vi.fn(),
    now: () => now.value,
  };
}

describe("Gate 1 proof recorder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the Chrome reopen clock from the proof harness activation action", () => {
    const now = { value: 25 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "macos",
      runtime: "chrome",
      timing: timing(now),
    });
    recorder.arm({ journey: "reopen-today", phase: "timed", run: 1 });
    recorder.beginReopen();
    now.value = 155;
    recorder.meaningfulScreen({ href: "/dashboard", meaningful: true, source: "server" });
    expect(recorder.snapshot().samples[0]).toMatchObject({
      bridgeProtocolVersion: null,
      durationMs: 130,
      journey: "reopen-today",
      runtime: "chrome",
      source: "server",
    });
  });

  it("records exact warmup/timed identifiers and meaningful screen evidence", () => {
    const now = { value: 100 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "macos",
      runtime: "desktop",
      timing: timing(now),
    });
    expect(
      recorder.arm({
        journey: "safe-clients-projects",
        phase: "timed",
        run: 1,
      }),
    ).toBe(true);
    recorder.start("safe-clients-projects");
    now.value = 420;
    recorder.meaningfulScreen({
      href: "/dashboard/clients-projects",
      meaningful: true,
      source: "cache",
    });
    expect(recorder.snapshot().samples).toEqual([
      expect.objectContaining({
        blankOrFullscreenSpinner: false,
        durationMs: 320,
        journey: "safe-clients-projects",
        meaningful: true,
        mediaDownloadRequests: 0,
        run: 1,
        source: "safe-view",
      }),
    ]);
  });

  it("proves cached audio had zero protected media downloads", () => {
    const now = { value: 500 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "windows",
      runtime: "desktop",
      timing: timing(now),
    });
    recorder.arm({ journey: "cached-recent-audio", phase: "timed", run: 5 });
    recorder.start("cached-recent-audio");
    recorder.audioSource("recent-cache");
    now.value = 650;
    recorder.audioPlaying();
    expect(recorder.snapshot().samples[0]).toMatchObject({
      durationMs: 150,
      meaningful: true,
      mediaDownloadRequests: 0,
      source: "recent-cache",
    });
  });

  it("rejects duplicate or out-of-range run slots", () => {
    const now = { value: 0 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "unknown",
      runtime: "chrome",
      timing: timing(now),
    });
    expect(recorder.arm({ journey: "reopen-today", phase: "timed", run: 6 })).toBe(false);
    expect(recorder.arm({ journey: "reopen-today", phase: "warmup", run: 0 })).toBe(true);
  });

  it("records an armed run that times out instead of silently omitting it", () => {
    vi.useFakeTimers();
    const now = { value: 0 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "windows",
      runtime: "desktop",
      timing: timing(now),
    });
    recorder.arm({ journey: "safe-clients-projects", phase: "timed", run: 3 });
    recorder.start("safe-clients-projects");
    now.value = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(recorder.snapshot().samples[0]).toMatchObject({
      blankOrFullscreenSpinner: true,
      durationMs: 10_000,
      meaningful: false,
      run: 3,
      source: null,
    });
  });

  it("records observed blank/spinner evidence on a failed screen run", () => {
    vi.useFakeTimers();
    const now = { value: 0 };
    const recorder = createGate1ProofRecorder({
      buildId: "build-a",
      enabled: true,
      origin: "https://proof.skitza.app",
      platform: "macos",
      runtime: "chrome",
      screenFailureEvidence: () => false,
      timing: timing(now),
    });
    recorder.arm({ journey: "safe-clients-projects", phase: "timed", run: 4 });
    recorder.start("safe-clients-projects");
    now.value = 10_000;
    vi.advanceTimersByTime(10_000);
    expect(recorder.snapshot().samples[0]).toMatchObject({
      blankOrFullscreenSpinner: false,
      meaningful: false,
    });
  });
});
