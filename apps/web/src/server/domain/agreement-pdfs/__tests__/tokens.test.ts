import { describe, expect, it } from "vitest";

import {
  AgreementPdfTokenError,
  agreementPdfObjectKeys,
  createAgreementPdfUploadToken,
  verifyOwnedAgreementPdfUploadToken,
} from "../tokens";

const SECRET = "agreement-pdf-test-secret-that-is-long-enough";

describe("private agreement PDF upload tokens", () => {
  it("binds an upload to the producer and signed-in viewer", () => {
    const signed = createAgreementPdfUploadToken(
      SECRET,
      {
        producerId: "producer-1",
        viewerClerkUserId: "user-1",
        originalFileName: "terms.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
      },
      new Date("2026-08-09T10:00:00.000Z"),
    );
    expect(
      verifyOwnedAgreementPdfUploadToken(
        SECRET,
        signed.token,
        { producerId: "producer-1", viewerClerkUserId: "user-1" },
        new Date("2026-08-09T10:01:00.000Z"),
      ),
    ).toEqual(signed.payload);
    expect(() =>
      verifyOwnedAgreementPdfUploadToken(
        SECRET,
        signed.token,
        { producerId: "producer-2", viewerClerkUserId: "user-1" },
        new Date("2026-08-09T10:01:00.000Z"),
      ),
    ).toThrow(AgreementPdfTokenError);
  });

  it("derives opaque private keys without file names or producer ids", () => {
    const keys = agreementPdfObjectKeys(SECRET, "a".repeat(64));
    expect(keys.finalKey).toMatch(/^agreement-pdfs\/[a-f0-9]{64}$/);
    expect(JSON.stringify(keys)).not.toContain("producer");
    expect(JSON.stringify(keys)).not.toContain("terms.pdf");
  });
});
