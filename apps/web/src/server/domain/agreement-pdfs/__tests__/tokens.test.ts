import { describe, expect, it } from "vitest";

import { resolveCapabilitySecret } from "~/server/security/capability-secrets";
import {
  AgreementPdfTokenError,
  agreementPdfObjectKeys,
  createAgreementPdfUploadToken,
  verifyOwnedAgreementPdfUploadToken,
  verifyOwnedAgreementPdfUploadTokenForCleanup,
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

  it("keeps an in-flight upload on its original derived storage path after rotation", () => {
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
    const verified = resolveCapabilitySecret(
      ["rotated-agreement-pdf-secret-that-is-long-enough", SECRET],
      (secret) =>
        verifyOwnedAgreementPdfUploadToken(
          secret,
          signed.token,
          { producerId: "producer-1", viewerClerkUserId: "user-1" },
          new Date("2026-08-09T10:01:00.000Z"),
        ),
    );

    expect(verified.secret).toBe(SECRET);
    expect(agreementPdfObjectKeys(verified.secret, verified.value.uploadId)).toEqual(
      agreementPdfObjectKeys(SECRET, signed.payload.uploadId),
    );
  });

  it("allows an expired authentic owner token only for staging cleanup", () => {
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
    const afterExpiry = new Date("2026-08-09T11:00:00.000Z");

    expect(() =>
      verifyOwnedAgreementPdfUploadToken(
        SECRET,
        signed.token,
        { producerId: "producer-1", viewerClerkUserId: "user-1" },
        afterExpiry,
      ),
    ).toThrow(AgreementPdfTokenError);
    expect(
      verifyOwnedAgreementPdfUploadTokenForCleanup(SECRET, signed.token, {
        producerId: "producer-1",
        viewerClerkUserId: "user-1",
      }),
    ).toEqual(signed.payload);
    expect(() =>
      verifyOwnedAgreementPdfUploadTokenForCleanup(SECRET, signed.token, {
        producerId: "producer-2",
        viewerClerkUserId: "user-1",
      }),
    ).toThrow(AgreementPdfTokenError);
  });
});
