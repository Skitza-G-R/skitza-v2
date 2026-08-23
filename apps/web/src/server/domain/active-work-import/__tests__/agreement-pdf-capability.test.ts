import { describe, expect, it } from "vitest";

import {
  ActiveWorkImportAgreementPdfCapabilityError,
  createActiveWorkImportAgreementPdfCapability,
  verifyActiveWorkImportAgreementPdfCapability,
} from "../agreement-pdf-capability";
import { ActiveWorkImportDomainError } from "../service";

const SECRET = "skitza-import-agreement-pdf-test-secret-long-enough";
const SCOPE = {
  producerId: "10000000-0000-4000-8000-000000000001",
  batchId: "20000000-0000-4000-8000-000000000002",
  rowId: "30000000-0000-4000-8000-000000000003",
};

describe("producer import agreement PDF capability", () => {
  it("binds producer, batch, row, and exact file metadata without a clock", () => {
    const signed = createActiveWorkImportAgreementPdfCapability(SECRET, {
      ...SCOPE,
      originalFileName: "agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_048,
    });

    expect(signed.payload).toMatchObject({
      version: 1,
      kind: "active_work_import_agreement_pdf",
      ...SCOPE,
      originalFileName: "agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_048,
    });
    expect(signed.payload.uploadId).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.payload).not.toHaveProperty("expiresAtEpochSeconds");
    expect(verifyActiveWorkImportAgreementPdfCapability(SECRET, signed.token, SCOPE)).toEqual(
      signed.payload,
    );
    for (const wrongScope of [
      { ...SCOPE, producerId: "10000000-0000-4000-8000-000000000009" },
      { ...SCOPE, batchId: "20000000-0000-4000-8000-000000000009" },
      { ...SCOPE, rowId: "30000000-0000-4000-8000-000000000009" },
    ]) {
      expect(() =>
        verifyActiveWorkImportAgreementPdfCapability(SECRET, signed.token, wrongScope),
      ).toThrow(ActiveWorkImportAgreementPdfCapabilityError);
    }
  });

  it("rejects tampering, wrong secrets, and derives a new identity for changed metadata", () => {
    const signed = createActiveWorkImportAgreementPdfCapability(SECRET, {
      ...SCOPE,
      originalFileName: "agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_048,
    });
    const tampered = `${signed.token.slice(0, -1)}${signed.token.endsWith("A") ? "B" : "A"}`;
    expect(() => verifyActiveWorkImportAgreementPdfCapability(SECRET, tampered, SCOPE)).toThrow(
      ActiveWorkImportAgreementPdfCapabilityError,
    );
    expect(() =>
      verifyActiveWorkImportAgreementPdfCapability(`${SECRET}-wrong`, signed.token, SCOPE),
    ).toThrow(ActiveWorkImportAgreementPdfCapabilityError);

    const changed = createActiveWorkImportAgreementPdfCapability(SECRET, {
      ...SCOPE,
      originalFileName: "agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: 2_049,
    });
    expect(changed.payload.uploadId).not.toBe(signed.payload.uploadId);
    const retried = createActiveWorkImportAgreementPdfCapability(SECRET, {
      ...SCOPE,
      originalFileName: "  agreement.pdf  ",
      contentType: " APPLICATION/PDF ",
      sizeBytes: 2_048,
    });
    expect(retried.payload.uploadId).toBe(signed.payload.uploadId);
  });

  it("accepts only a real PDF as plain invalid input", () => {
    for (const input of [
      { originalFileName: "agreement.png", contentType: "image/png" },
      { originalFileName: "agreement.pdf", contentType: "image/png" },
      { originalFileName: "agree/ment.pdf", contentType: "application/pdf" },
    ]) {
      let thrown: unknown;
      try {
        createActiveWorkImportAgreementPdfCapability(SECRET, { ...SCOPE, ...input, sizeBytes: 10 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ActiveWorkImportDomainError);
      expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(() =>
      createActiveWorkImportAgreementPdfCapability(SECRET, {
        ...SCOPE,
        originalFileName: "agreement.pdf",
        contentType: "application/pdf",
        sizeBytes: 16 * 1024 * 1024,
      }),
    ).toThrow("Agreement PDFs must be between 1 byte and 15 MB.");
  });
});
