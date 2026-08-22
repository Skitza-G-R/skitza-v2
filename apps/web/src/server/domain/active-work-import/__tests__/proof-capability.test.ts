import { describe, expect, it } from "vitest";

import {
  ActiveWorkImportProofCapabilityError,
  createActiveWorkImportProofCapability,
  verifyActiveWorkImportProofCapability,
} from "../proof-capability";
import { ActiveWorkImportDomainError } from "../service";

const SECRET = "skitza-import-proof-test-secret-long-enough";
const SCOPE = {
  producerId: "10000000-0000-4000-8000-000000000001",
  batchId: "20000000-0000-4000-8000-000000000002",
  rowId: "30000000-0000-4000-8000-000000000003",
  paymentOperationKey: "historical-payment-1",
};

describe("producer import proof capability", () => {
  it("binds producer, batch, row, operation, and exact file metadata durably", () => {
    const signed = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    });
    expect(verifyActiveWorkImportProofCapability(SECRET, signed.token, SCOPE)).toEqual(
      signed.payload,
    );
    for (const wrongScope of [
      { ...SCOPE, producerId: "10000000-0000-4000-8000-000000000009" },
      { ...SCOPE, batchId: "20000000-0000-4000-8000-000000000009" },
      { ...SCOPE, rowId: "30000000-0000-4000-8000-000000000009" },
      { ...SCOPE, paymentOperationKey: "historical-payment-2" },
    ]) {
      expect(() => verifyActiveWorkImportProofCapability(SECRET, signed.token, wrongScope)).toThrow(
        ActiveWorkImportProofCapabilityError,
      );
    }
  });

  it("keeps a saved exact proof reference valid after the short upload URL expires", () => {
    const signed = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    });

    // The R2 URL still expires independently in storage.ts. This signed row
    // reference has no clock input and remains resumable after returning later.
    expect(verifyActiveWorkImportProofCapability(SECRET, signed.token, SCOPE)).toEqual(
      signed.payload,
    );
    expect(signed.payload).not.toHaveProperty("expiresAtEpochSeconds");
  });

  it("rejects tampering, wrong secrets, and changed metadata", () => {
    const signed = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      originalFileName: "receipt.png",
      contentType: "image/png",
      sizeBytes: 1_024,
    });
    const tampered = `${signed.token.slice(0, -1)}${signed.token.endsWith("A") ? "B" : "A"}`;
    expect(() => verifyActiveWorkImportProofCapability(SECRET, tampered, SCOPE)).toThrow(
      ActiveWorkImportProofCapabilityError,
    );
    expect(() =>
      verifyActiveWorkImportProofCapability(`${SECRET}-wrong`, signed.token, SCOPE),
    ).toThrow(ActiveWorkImportProofCapabilityError);

    const changed = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      originalFileName: "receipt.png",
      contentType: "image/png",
      sizeBytes: 1_025,
    });
    expect(changed.payload.uploadId).not.toBe(signed.payload.uploadId);
  });

  it("reports a rejected file name or type as plain invalid input, not a broken capability", () => {
    const rejected = [
      { originalFileName: "re/ceipt.pdf", contentType: "application/pdf" },
      { originalFileName: "receipt.txt", contentType: "text/plain" },
    ];
    for (const input of rejected) {
      let thrown: unknown;
      try {
        createActiveWorkImportProofCapability(SECRET, { ...SCOPE, ...input, sizeBytes: 512 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ActiveWorkImportDomainError);
      expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(() =>
      createActiveWorkImportProofCapability(SECRET, {
        ...SCOPE,
        originalFileName: "re/ceipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 512,
      }),
    ).toThrow("File name contains unsupported characters");
    expect(() =>
      createActiveWorkImportProofCapability(SECRET, {
        ...SCOPE,
        originalFileName: "receipt.txt",
        contentType: "text/plain",
        sizeBytes: 512,
      }),
    ).toThrow("Choose a JPG, PNG, WebP, HEIC, or PDF file");
  });

  it("canonicalizes retries before deriving the deterministic object identity", () => {
    const first = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      paymentOperationKey: `  ${SCOPE.paymentOperationKey}  `,
      originalFileName: "  receipt.pdf  ",
      contentType: " APPLICATION/PDF ",
      sizeBytes: 512,
    });
    const retry = createActiveWorkImportProofCapability(SECRET, {
      ...SCOPE,
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    });
    expect(first.payload).toEqual(retry.payload);
    expect(first.token).toBe(retry.token);
  });
});
