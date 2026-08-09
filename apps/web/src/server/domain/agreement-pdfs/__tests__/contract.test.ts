import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AgreementPdfContractError,
  agreementPdfClientSnapshot,
  agreementPdfContractDocumentsForCleanup,
  agreementPdfContractReferencesStorageKey,
  agreementPdfProducerSummary,
  appendAgreementPdfRevision,
  currentAgreementPdfRevision,
  findAgreementPdfRevision,
  isAgreementPdfContractPendingCleanup,
  markAgreementPdfContractForCleanup,
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

function classifyWithOldDeploymentPrefixGate(value: string): "legacy" | "ledger" {
  const prefix = "skitza-private-agreement:v1:";
  if (!value.startsWith(prefix)) return "legacy";
  if (!/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length))) {
    throw new AgreementPdfContractError();
  }
  return "ledger";
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
    expect(
      agreementPdfContractReferencesStorageKey(removed, first.document?.storageKey ?? ""),
    ).toBe(true);
    expect(
      agreementPdfContractReferencesStorageKey(removed, `agreement-pdfs/${"f".repeat(64)}`),
    ).toBe(false);
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

  it("turns a no-history ledger into a terminal server-only cleanup tombstone", () => {
    const first = revision("terms.pdf", "2026-08-09T10:00:00.000Z");
    const live = appendAgreementPdfRevision(null, first);
    const cleanup = markAgreementPdfContractForCleanup(live);

    expect(isAgreementPdfContractPendingCleanup(cleanup)).toBe(true);
    expect(cleanup).toMatch(/^skitza-private-agreement:v1:cleanup:/);
    expect(cleanup.slice("skitza-private-agreement:v1:".length)).not.toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => classifyWithOldDeploymentPrefixGate(cleanup)).toThrow(AgreementPdfContractError);
    expect(markAgreementPdfContractForCleanup(cleanup)).toBe(cleanup);
    expect(currentAgreementPdfRevision(cleanup)).toBeNull();
    expect(findAgreementPdfRevision(cleanup, first.revisionId)).toBeNull();
    expect(agreementPdfContractDocumentsForCleanup(cleanup)).toEqual([first.document]);
    expect(
      agreementPdfContractReferencesStorageKey(cleanup, first.document?.storageKey ?? ""),
    ).toBe(true);
    expect(agreementPdfProducerSummary(cleanup)).toEqual({
      agreementPdf: null,
      legacyAgreementLinkPresent: false,
    });
    expect(JSON.stringify(agreementPdfProducerSummary(cleanup))).not.toContain("agreement-pdfs/");
    expect(() =>
      appendAgreementPdfRevision(cleanup, revision("new.pdf", "2026-08-09T11:00:00.000Z")),
    ).toThrow(AgreementPdfContractError);
  });

  it("fails closed for malformed prefixed metadata", () => {
    expect(() => currentAgreementPdfRevision("skitza-private-agreement:v1:not-json")).toThrow(
      AgreementPdfContractError,
    );
    expect(() =>
      currentAgreementPdfRevision("skitza-private-agreement:v1:cleanup:not-json"),
    ).toThrow(AgreementPdfContractError);
  });
});
