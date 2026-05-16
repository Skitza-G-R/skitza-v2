import { describe, expect, it, vi } from "vitest";

import { computePeaksFromBytes, computePeaksFromUrl } from "../peaks";

// The server peaks helper is a thin wrapper around audio-decode +
// shared rmsPeaks math. The pure peaks math has its own unit-test
// suite (lib/audio/__tests__/rms-peaks.test.ts) so these tests focus on
// the wrapper's error-handling contract: every failure path returns
// null so audio.completeMultipart can save peaks=null and let the
// client-side decode fallback render the envelope.

describe("computePeaksFromBytes — handles bad input without throwing", () => {
  it("returns null for an empty buffer", async () => {
    const result = await computePeaksFromBytes(new ArrayBuffer(0));
    expect(result).toBeNull();
  });

  it("returns null when audio-decode rejects garbage bytes", async () => {
    // 64 bytes of garbage — no valid audio container starts with this.
    const bytes = new Uint8Array(64).fill(0x42);
    const result = await computePeaksFromBytes(bytes);
    expect(result).toBeNull();
  });

  it("handles Uint8Array input the same as ArrayBuffer", async () => {
    // Both forms must short-circuit on empty.
    const u8 = new Uint8Array(0);
    expect(await computePeaksFromBytes(u8)).toBeNull();
  });
});

describe("computePeaksFromUrl — fetch + decode failure paths", () => {
  it("returns null when fetch returns non-OK", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 404 }),
    );
    const result = await computePeaksFromUrl("https://r2.example/missing.mp3");
    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("returns null when fetch throws", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));
    const result = await computePeaksFromUrl("https://r2.example/x.mp3");
    expect(result).toBeNull();
    fetchSpy.mockRestore();
  });
});
