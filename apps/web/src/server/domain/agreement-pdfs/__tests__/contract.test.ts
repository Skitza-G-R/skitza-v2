import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AgreementPdfContractError,
  agreementPdfClientSnapshot,
  agreementPdfProducerSummary,
  appendAgreementPdfRevision,
  currentAgreementPdfRevision,
  findAgreementPdfRevision,
  type AgreementPdfRevision,
} from "../contract";

function revision(name: string, at: string): AgreementPdfRevision {
  return {
    revisionId: randomUUID(),
    effectiveAt: at,
    document: {
      storageBucket: "docs",
      storageKey: `agreement-pdfs/${"a".repeat(64)}`,
      originalFileName: name,
      contentType: "application/pdf",
      sizeBytes: 100,
      objectEtag: '"etag"',
      sha256: "b".repeat(64),
    },
  };
}

describe("private agreement PDF contract", () => {
  it("keeps replacement and removal revisions addressable while exposing only client-safe metadata", () => {
    const first = revision("terms-v1.pdf", "2026-08-09T10:00:00.000Z");
    const second: AgreementPdfRevision = {
      revisionId: randomUUID(),
      effectiveAt: "2026-08-09T11:00:00.000Z",
      document: null,
    };
    const withFirst = appendAgreementPdfRevision(null, first);
    const removed = appendAgreementPdfRevision(withFirst, second);

    expect(currentAgreementPdfRevision(removed)).toEqual(second);
    expect(findAgreementPdfRevision(removed, first.revisionId)).toEqual(first);
    expect(agreementPdfClientSnapshot(first)).toEqual({
      documentId: first.revisionId,
      originalFileName: "terms-v1.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      objectEtag: '"etag"',
      sha256: "b".repeat(64),
    });
    expect(JSON.stringify(agreementPdfClientSnapshot(first))).not.toContain("storageKey");
    expect(JSON.stringify(agreementPdfProducerSummary(removed))).not.toContain("agreement-pdfs/");
  });

  it("classifies old external values without ever returning the URL", () => {
    expect(agreementPdfProducerSummary("https://example.com/changeable.pdf")).toEqual({
      agreementPdf: null,
      legacyAgreementLinkPresent: true,
    });
  });

  it("fails closed for malformed prefixed metadata", () => {
    expect(() => currentAgreementPdfRevision("skitza-private-agreement:v1:not-json")).toThrow(
      AgreementPdfContractError,
    );
  });
});
