import { describe, expect, it } from "vitest";

import { agreementPdfClientSnapshot, appendAgreementPdfRevision } from "../contract";
import {
  AgreementPdfEvidenceError,
  authorizeAcceptedAgreementPdf,
  authorizeCurrentRequestAgreementPdf,
} from "../evidence";

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

// Each `limit()` answers the next lookup in order, so a test can state exactly
// which ownership query finds the purchase.
function sequencedEvidenceDb(results: readonly unknown[][]) {
  const queue = [...results];
  const query = {
    innerJoin: () => query,
    where: () => query,
    limit: () => Promise.resolve(queue.shift() ?? []),
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

describe("imported purchase agreement evidence", () => {
  it("serves the frozen PDF from the import attestation ledger and rejects a changed snapshot", async () => {
    const first = revision(1);
    const contract = appendAgreementPdfRevision(null, first);
    const agreementPdf = agreementPdfClientSnapshot(first);
    if (!agreementPdf) throw new Error("Expected agreement snapshot");
    const commercialSnapshot = { agreementMode: "pdf", agreementPdf };
    // Not a private offer, not a store product (4 lookups), then the imported row.
    const notFoundBefore: unknown[][] = [[], [], [], []];

    await expect(
      authorizeAcceptedAgreementPdf(
        sequencedEvidenceDb([...notFoundBefore, [{ contractUrl: contract, commercialSnapshot }]]),
        { clerkUserId: "artist-1", purchaseId: "purchase-1" },
      ),
    ).resolves.toEqual(first.document);

    // Producer side: the artist lookup misses, the producer lookup hits.
    await expect(
      authorizeAcceptedAgreementPdf(
        sequencedEvidenceDb([
          ...notFoundBefore,
          [],
          [{ contractUrl: contract, commercialSnapshot }],
        ]),
        { clerkUserId: "producer-1", purchaseId: "purchase-1" },
      ),
    ).resolves.toEqual(first.document);

    const other = agreementPdfClientSnapshot(revision(2));
    await expect(
      authorizeAcceptedAgreementPdf(
        sequencedEvidenceDb([
          ...notFoundBefore,
          [
            {
              contractUrl: contract,
              commercialSnapshot: { agreementMode: "pdf", agreementPdf: other },
            },
          ],
        ]),
        { clerkUserId: "artist-1", purchaseId: "purchase-1" },
      ),
    ).rejects.toBeInstanceOf(AgreementPdfEvidenceError);

    await expect(
      authorizeAcceptedAgreementPdf(sequencedEvidenceDb([...notFoundBefore, [], []]), {
        clerkUserId: "stranger",
        purchaseId: "purchase-1",
      }),
    ).rejects.toBeInstanceOf(AgreementPdfEvidenceError);
  });
});
