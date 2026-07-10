import { describe, it, expect } from "vitest";
import {
  buildAudioKey,
  buildDocKey,
  buildFinalProofKey,
  buildProofStagingKey,
  encodeR2CopySource,
  hasValidProofFileSignature,
  isProofStagingKeyForPurchase,
} from "./r2";

describe("r2 key builders", () => {
  it("namespaces audio keys by producer + track version", () => {
    const key = buildAudioKey({
      producerId: "p_123",
      trackVersionId: "tv_456",
      filename: "mix.wav",
    });
    expect(key).toBe("producers/p_123/tracks/tv_456/mix.wav");
  });
  it("namespaces doc keys by producer + contract", () => {
    const key = buildDocKey({
      producerId: "p_123",
      contractId: "c_789",
      filename: "agreement.pdf",
    });
    expect(key).toBe("producers/p_123/contracts/c_789/agreement.pdf");
  });
  it("sanitizes filename path separators", () => {
    const key = buildAudioKey({
      producerId: "p_1",
      trackVersionId: "tv_1",
      filename: "../../etc/passwd",
    });
    expect(key).not.toMatch(/\.\./);
  });

  it("uses one deterministic staging object for each purchase", () => {
    const args = { producerId: "p_123", purchaseRequestId: "pr_456" };

    expect(buildProofStagingKey(args)).toBe("proof-staging/producers/p_123/requests/pr_456/upload");
    expect(buildProofStagingKey(args)).toBe(buildProofStagingKey(args));
  });

  it("creates final proof keys with 128 random bits", () => {
    const args = {
      producerId: "p_123",
      purchaseRequestId: "pr_456",
      filename: "payment proof.pdf",
    };

    const first = buildFinalProofKey(args);
    const second = buildFinalProofKey(args);

    expect(first).toMatch(
      /^producers\/p_123\/proofs\/pr_456\/final\/[0-9a-f]{32}-payment_proof\.pdf$/,
    );
    expect(second).toMatch(
      /^producers\/p_123\/proofs\/pr_456\/final\/[0-9a-f]{32}-payment_proof\.pdf$/,
    );
    expect(second).not.toBe(first);
  });

  it("only accepts the exact staging key owned by the purchase", () => {
    const args = { producerId: "p_123", purchaseRequestId: "pr_456" };
    const key = buildProofStagingKey(args);

    expect(isProofStagingKeyForPurchase(key, args)).toBe(true);
    expect(isProofStagingKeyForPurchase(`${key}/extra`, args)).toBe(false);
    expect(
      isProofStagingKeyForPurchase(key, {
        producerId: "p_other",
        purchaseRequestId: args.purchaseRequestId,
      }),
    ).toBe(false);
    expect(
      isProofStagingKeyForPurchase(key, {
        producerId: args.producerId,
        purchaseRequestId: "pr_other",
      }),
    ).toBe(false);
  });

  it("URL-encodes every R2 CopySource path segment", () => {
    expect(
      encodeR2CopySource(
        "skitza-docs",
        "producers/p 123/proofs/pr#456/final/payment 100% € !'()*.pdf",
      ),
    ).toBe(
      "skitza-docs/producers/p%20123/proofs/pr%23456/final/payment%20100%25%20%E2%82%AC%20%21%27%28%29%2A.pdf",
    );
  });

  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/webp", [...Buffer.from("RIFF0000WEBP")]],
    ["image/heic", [0, 0, 0, 24, ...Buffer.from("ftypheic")]],
    ["application/pdf", [...Buffer.from("%PDF-1.7")]],
  ])("accepts a real %s signature", (contentType, signature) => {
    expect(hasValidProofFileSignature(contentType, Uint8Array.from(signature))).toBe(true);
  });

  it("rejects browser-supplied MIME metadata when the bytes are HTML", () => {
    const html = Uint8Array.from(Buffer.from("<script>alert(1)</script>"));
    expect(hasValidProofFileSignature("image/png", html)).toBe(false);
    expect(hasValidProofFileSignature("application/pdf", html)).toBe(false);
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
    const key = buildAudioKey({
      producerId: "p_1",
      trackVersionId: "tv_1",
      filename: "הופעה חיה.mp3",
    });
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
