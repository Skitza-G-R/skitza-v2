import {
  and,
  clientContacts,
  eq,
  products,
  producers,
  purchaseRequests,
  purchases,
  type Db,
} from "@skitza/db";

import {
  agreementPdfFromCommercialSnapshot,
  parseAgreementPdfClientSnapshot,
} from "~/lib/agreement-pdf";

import {
  agreementPdfClientSnapshot,
  currentAgreementPdfRevision,
  findAgreementPdfRevision,
  type AgreementPdfDocument,
} from "./contract";

export class AgreementPdfEvidenceError extends Error {
  constructor() {
    super("Private agreement was not found");
    this.name = "AgreementPdfEvidenceError";
  }
}

function unavailable(): never {
  throw new AgreementPdfEvidenceError();
}

function exactDocumentForAcceptedSnapshot(
  contractUrl: string | null,
  commercialSnapshot: unknown,
): AgreementPdfDocument {
  if (
    commercialSnapshot === null ||
    typeof commercialSnapshot !== "object" ||
    Array.isArray(commercialSnapshot) ||
    !Object.prototype.hasOwnProperty.call(commercialSnapshot, "agreementPdf")
  ) {
    unavailable();
  }
  const snapshot = agreementPdfFromCommercialSnapshot(commercialSnapshot);
  if (!snapshot || parseAgreementPdfClientSnapshot(snapshot) === null) unavailable();
  const revision = findAgreementPdfRevision(contractUrl, snapshot.documentId);
  if (!revision?.document) unavailable();
  const resolved = agreementPdfClientSnapshot(revision);
  if (!resolved || JSON.stringify(resolved) !== JSON.stringify(snapshot)) unavailable();
  return revision.document;
}

export async function authorizeCurrentRequestAgreementPdf(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; purchaseRequestId: string },
): Promise<AgreementPdfDocument> {
  const [row] = await db
    .select({ contractUrl: products.contractUrl, requestStatus: purchaseRequests.status })
    .from(purchaseRequests)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchaseRequests.clientContactId),
        eq(clientContacts.producerId, purchaseRequests.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.id, purchaseRequests.productId),
        eq(products.producerId, purchaseRequests.producerId),
      ),
    )
    .where(eq(purchaseRequests.id, input.purchaseRequestId))
    .limit(1);
  const document =
    row?.requestStatus === "approved"
      ? currentAgreementPdfRevision(row.contractUrl)?.document
      : null;
  if (!document) unavailable();
  return document;
}

export async function authorizeAcceptedAgreementPdf(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; purchaseId: string },
): Promise<AgreementPdfDocument> {
  const [artistRow] = await db
    .select({
      contractUrl: products.contractUrl,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .innerJoin(
      products,
      and(eq(products.id, purchases.productId), eq(products.producerId, purchases.producerId)),
    )
    .where(eq(purchases.id, input.purchaseId))
    .limit(1);
  if (artistRow) {
    return exactDocumentForAcceptedSnapshot(artistRow.contractUrl, artistRow.commercialSnapshot);
  }

  const [producerRow] = await db
    .select({
      contractUrl: products.contractUrl,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(
      producers,
      and(eq(producers.id, purchases.producerId), eq(producers.clerkUserId, input.clerkUserId)),
    )
    .innerJoin(
      products,
      and(eq(products.id, purchases.productId), eq(products.producerId, purchases.producerId)),
    )
    .where(eq(purchases.id, input.purchaseId))
    .limit(1);
  if (!producerRow) unavailable();
  return exactDocumentForAcceptedSnapshot(producerRow.contractUrl, producerRow.commercialSnapshot);
}
