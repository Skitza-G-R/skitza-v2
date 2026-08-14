import { describe, expect, it } from "vitest";

import { resolveCapabilitySecret } from "~/server/security/capability-secrets";
import {
  createProofEvidenceToken,
  createProofUploadToken,
  proofObjectKeys,
  ProofTokenError,
  verifyProofEvidenceToken,
  verifyOwnedProofUploadToken,
  verifyProofUploadToken,
} from "../tokens";

const SECRET = "skitza-test-secret-that-is-long-enough";
const NOW = new Date("2026-07-20T10:00:00.000Z");

describe("private proof upload tokens", () => {
  it("binds the upload to viewer, purchase, installment, filename, type, size, and expiry", () => {
    const signed = createProofUploadToken(
      SECRET,
      {
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        viewerClerkUserId: "artist-clerk-1",
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 12_345,
      },
      NOW,
    );

    expect(verifyProofUploadToken(SECRET, signed.token, NOW)).toEqual(signed.payload);
    expect(signed.payload.uploadId).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      verifyProofUploadToken(SECRET, signed.token, new Date(NOW.getTime() + 600_000)),
    ).toThrow(ProofTokenError);
  });

  it("rejects tampering, wrong secrets, non-canonical tokens, and token-kind confusion", () => {
    const { token } = createProofUploadToken(
      SECRET,
      {
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        viewerClerkUserId: "artist-clerk-1",
        originalFileName: "receipt.png",
        contentType: "image/png",
        sizeBytes: 512,
      },
      NOW,
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(() => verifyProofUploadToken(SECRET, tampered, NOW)).toThrow(ProofTokenError);
    expect(() => verifyProofUploadToken(`${SECRET}-wrong`, token, NOW)).toThrow(ProofTokenError);

    const evidence = createProofEvidenceToken(
      SECRET,
      { proofId: "proof-1", viewerClerkUserId: "artist-clerk-1", viewerRole: "artist" },
      NOW,
    );
    expect(() => verifyProofUploadToken(SECRET, evidence, NOW)).toThrow(ProofTokenError);
  });

  it("authorizes cleanup only for the token-bound viewer, purchase, and installment", () => {
    const signed = createProofUploadToken(
      SECRET,
      {
        purchaseId: "purchase-1",
        installmentId: "installment-1",
        viewerClerkUserId: "artist-clerk-1",
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 512,
      },
      NOW,
    );
    const exactScope = {
      viewerClerkUserId: "artist-clerk-1",
      purchaseId: "purchase-1",
      installmentId: "installment-1",
    };

    expect(verifyOwnedProofUploadToken(SECRET, signed.token, exactScope, NOW)).toEqual(
      signed.payload,
    );
    for (const wrongScope of [
      { ...exactScope, viewerClerkUserId: "artist-clerk-2" },
      { ...exactScope, purchaseId: "purchase-2" },
      { ...exactScope, installmentId: "installment-2" },
    ]) {
      expect(() => verifyOwnedProofUploadToken(SECRET, signed.token, wrongScope, NOW)).toThrow(
        ProofTokenError,
      );
    }
  });

  it("derives opaque server-only object identities without embedding business identifiers", () => {
    const uploadId = "a".repeat(64);
    const first = proofObjectKeys(SECRET, uploadId);
    const retry = proofObjectKeys(SECRET, uploadId);
    expect(first).toEqual(retry);
    expect(first.stagingKey).toMatch(/^proof-staging\/[a-f0-9]{64}$/);
    expect(first.finalKey).toMatch(/^proof-evidence\/[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain(uploadId);
    expect(proofObjectKeys(SECRET, "b".repeat(64))).not.toEqual(first);
  });
});

describe("private proof evidence tokens", () => {
  it("binds a five-minute evidence read to one viewer and role", () => {
    const token = createProofEvidenceToken(
      SECRET,
      { proofId: "proof-1", viewerClerkUserId: "producer-clerk-1", viewerRole: "producer" },
      NOW,
    );
    expect(verifyProofEvidenceToken(SECRET, token, NOW)).toMatchObject({
      kind: "proof_evidence",
      proofId: "proof-1",
      viewerClerkUserId: "producer-clerk-1",
      viewerRole: "producer",
    });
    expect(() =>
      verifyProofEvidenceToken(SECRET, token, new Date(NOW.getTime() + 300_000)),
    ).toThrow(ProofTokenError);
  });

  it("keeps an in-flight evidence link valid through the legacy key ring", () => {
    const token = createProofEvidenceToken(
      SECRET,
      { proofId: "proof-1", viewerClerkUserId: "artist-clerk-1", viewerRole: "artist" },
      NOW,
    );
    const verified = resolveCapabilitySecret(
      ["rotated-skitza-test-secret-that-is-long-enough", SECRET],
      (secret) => verifyProofEvidenceToken(secret, token, NOW),
    );

    expect(verified.secret).toBe(SECRET);
    expect(verified.value.proofId).toBe("proof-1");
  });
});
