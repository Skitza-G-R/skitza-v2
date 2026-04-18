import { describe, it, expect } from "vitest";
import { buildAudioKey, buildDocKey } from "./r2";

describe("r2 key builders", () => {
  it("namespaces audio keys by producer + track version", () => {
    const key = buildAudioKey({ producerId: "p_123", trackVersionId: "tv_456", filename: "mix.wav" });
    expect(key).toBe("producers/p_123/tracks/tv_456/mix.wav");
  });
  it("namespaces doc keys by producer + contract", () => {
    const key = buildDocKey({ producerId: "p_123", contractId: "c_789", filename: "agreement.pdf" });
    expect(key).toBe("producers/p_123/contracts/c_789/agreement.pdf");
  });
  it("sanitizes filename path separators", () => {
    const key = buildAudioKey({ producerId: "p_1", trackVersionId: "tv_1", filename: "../../etc/passwd" });
    expect(key).not.toMatch(/\.\./);
  });
});

describe("r2 sanitize non-ASCII fallback", () => {
  it("generates track-<hex> fallback for empty filename", () => {
    const key = buildAudioKey({ producerId: "p", trackVersionId: "tv", filename: "" });
    expect(key).toMatch(/^producers\/p\/tracks\/tv\/track-[0-9a-f]{8}$/);
  });
  it("generates track-<hex> fallback when filename sanitizes to all underscores", () => {
    const key = buildAudioKey({ producerId: "p", trackVersionId: "tv", filename: "///" });
    expect(key).toMatch(/^producers\/p\/tracks\/tv\/track-[0-9a-f]{8}$/);
  });
  it("preserves extension when body is all non-ASCII (Hebrew)", () => {
    const key = buildAudioKey({ producerId: "p_1", trackVersionId: "tv_1", filename: "הופעה חיה.mp3" });
    expect(key).toMatch(/^producers\/p_1\/tracks\/tv_1\/track-[0-9a-f]{8}\.mp3$/);
  });
  it("preserves English filenames unchanged", () => {
    const key = buildAudioKey({ producerId: "p", trackVersionId: "tv", filename: "my-mix.wav" });
    expect(key).toBe("producers/p/tracks/tv/my-mix.wav");
  });
  it("two non-ASCII filenames produce DIFFERENT keys (no collision)", () => {
    const k1 = buildAudioKey({ producerId: "p", trackVersionId: "tv", filename: "שיר.mp3" });
    const k2 = buildAudioKey({ producerId: "p", trackVersionId: "tv", filename: "אחר.mp3" });
    expect(k1).not.toBe(k2);
  });
});
