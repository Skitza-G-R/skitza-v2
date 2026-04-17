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
