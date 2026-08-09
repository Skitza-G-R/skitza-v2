import { describe, expect, it } from "vitest";

import { agreementPdfClientSnapshot, appendAgreementPdfRevision } from "../contract";
import { AgreementPdfEvidenceError, authorizeCurrentRequestAgreementPdf } from "../evidence";

function requestEvidenceDb(row: { contractUrl: string; requestStatus: string }) {
  const query = {
    innerJoin: () => query,
    where: () => query,
    limit: () => Promise.resolve([row]),
  };
  return {
    select: () => ({ from: () => query }),
  } as never;
}

function revision(index: 1 | 2) {
  const hex = String(index);
  return {
    revisionId: `00000000-0000-4000-8000-00000000000${hex}`,
    effectiveAt: `2026-08-09T0${hex}:00:00.000Z`,
    document: {
      storageBucket: "docs" as const,
      storageKey: `agreement-pdfs/${hex.repeat(64)}`,
      originalFileName: `terms-v${hex}.pdf`,
      contentType: "application/pdf" as const,
      sizeBytes: 100 + index,
      objectEtag: `"etag-${hex}"`,
      sha256: hex.repeat(64),
    },
  };
}

describe("current request agreement evidence", () => {
  it("rejects the stale A link after the current proposal is replaced by B", async () => {
    const first = revision(1);
    const second = revision(2);
    const contractA = appendAgreementPdfRevision(null, first);
    const contractB = appendAgreementPdfRevision(contractA, second);
    const snapshotA = agreementPdfClientSnapshot(first);
    if (!snapshotA) throw new Error("Expected agreement snapshot A");

    await expect(
      authorizeCurrentRequestAgreementPdf(
        requestEvidenceDb({
          contractUrl: contractA,
          requestStatus: "approved",
        }),
        {
          clerkUserId: "artist-1",
          purchaseRequestId: "request-1",
          expectedDocumentId: snapshotA.documentId,
        },
      ),
    ).resolves.toEqual(first.document);

    await expect(
      authorizeCurrentRequestAgreementPdf(
        requestEvidenceDb({
          contractUrl: contractB,
          requestStatus: "approved",
        }),
        {
          clerkUserId: "artist-1",
          purchaseRequestId: "request-1",
          expectedDocumentId: snapshotA.documentId,
        },
      ),
    ).rejects.toBeInstanceOf(AgreementPdfEvidenceError);
  });
});
