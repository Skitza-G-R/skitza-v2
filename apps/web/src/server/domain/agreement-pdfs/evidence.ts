import {
  and,
  clientContacts,
  eq,
  inArray,
  isNull,
  privateOffers,
  products,
  producers,
  purchaseImportAttestations,
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
  expectedDocumentId?: string,
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
  if (expectedDocumentId && snapshot.documentId !== expectedDocumentId) unavailable();
  const revision = findAgreementPdfRevision(contractUrl, snapshot.documentId);
  if (!revision?.document) unavailable();
  const resolved = agreementPdfClientSnapshot(revision);
  if (!resolved || JSON.stringify(resolved) !== JSON.stringify(snapshot)) unavailable();
  return revision.document;
}

export async function authorizeCurrentRequestAgreementPdf(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; purchaseRequestId: string; expectedDocumentId: string },
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
  const revision =
    row?.requestStatus === "approved" ? currentAgreementPdfRevision(row.contractUrl) : null;
  const resolved = agreementPdfClientSnapshot(revision);
  if (!revision?.document || !resolved || resolved.documentId !== input.expectedDocumentId) {
    unavailable();
  }
  return revision.document;
}

export async function authorizeAcceptedAgreementPdf(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; purchaseId: string },
): Promise<AgreementPdfDocument> {
  const [privateArtistRow] = await db
    .select({
      contractUrl: privateOffers.agreementPdfContract,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(privateOffers, eq(privateOffers.id, purchases.privateOfferId))
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .where(eq(purchases.id, input.purchaseId))
    .limit(1);
  if (privateArtistRow) {
    return exactDocumentForAcceptedSnapshot(
      privateArtistRow.contractUrl,
      privateArtistRow.commercialSnapshot,
    );
  }

  const [privateProducerRow] = await db
    .select({
      contractUrl: privateOffers.agreementPdfContract,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(privateOffers, eq(privateOffers.id, purchases.privateOfferId))
    .innerJoin(
      producers,
      and(eq(producers.id, purchases.producerId), eq(producers.clerkUserId, input.clerkUserId)),
    )
    .where(eq(purchases.id, input.purchaseId))
    .limit(1);
  if (privateProducerRow) {
    return exactDocumentForAcceptedSnapshot(
      privateProducerRow.contractUrl,
      privateProducerRow.commercialSnapshot,
    );
  }

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
  if (producerRow) {
    return exactDocumentForAcceptedSnapshot(
      producerRow.contractUrl,
      producerRow.commercialSnapshot,
    );
  }

  // Work brought in by the producer (SK-255/SK-259) has neither a product nor
  // a private offer: its private ledger sits beside the import attestation.
  const [importedArtistRow] = await db
    .select({
      contractUrl: purchaseImportAttestations.agreementPdfContract,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(
      purchaseImportAttestations,
      and(
        eq(purchaseImportAttestations.purchaseId, purchases.id),
        eq(purchaseImportAttestations.producerId, purchases.producerId),
        eq(purchaseImportAttestations.clientContactId, purchases.clientContactId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .where(
      and(eq(purchases.id, input.purchaseId), eq(purchases.sourceKind, "imported_existing_work")),
    )
    .limit(1);
  if (importedArtistRow) {
    return exactDocumentForAcceptedSnapshot(
      importedArtistRow.contractUrl,
      importedArtistRow.commercialSnapshot,
    );
  }

  const [importedProducerRow] = await db
    .select({
      contractUrl: purchaseImportAttestations.agreementPdfContract,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .innerJoin(
      purchaseImportAttestations,
      and(
        eq(purchaseImportAttestations.purchaseId, purchases.id),
        eq(purchaseImportAttestations.producerId, purchases.producerId),
        eq(purchaseImportAttestations.clientContactId, purchases.clientContactId),
      ),
    )
    .innerJoin(
      producers,
      and(eq(producers.id, purchases.producerId), eq(producers.clerkUserId, input.clerkUserId)),
    )
    .where(
      and(eq(purchases.id, input.purchaseId), eq(purchases.sourceKind, "imported_existing_work")),
    )
    .limit(1);
  if (!importedProducerRow) unavailable();
  return exactDocumentForAcceptedSnapshot(
    importedProducerRow.contractUrl,
    importedProducerRow.commercialSnapshot,
  );
}

export async function authorizeProducerProductAgreementPdf(
  db: Pick<Db, "select">,
  input: { clerkUserId: string; productId: string; expectedDocumentId: string },
): Promise<AgreementPdfDocument> {
  const [row] = await db
    .select({ contractUrl: products.contractUrl })
    .from(products)
    .innerJoin(
      producers,
      and(eq(producers.id, products.producerId), eq(producers.clerkUserId, input.clerkUserId)),
    )
    .where(eq(products.id, input.productId))
    .limit(1);
  const revision = row ? findAgreementPdfRevision(row.contractUrl, input.expectedDocumentId) : null;
  if (!revision?.document) unavailable();
  return revision.document;
}

export async function authorizePrivateOfferAgreementPdf(
  db: Pick<Db, "select">,
  input: {
    clerkUserId: string;
    verifiedEmailHashes: string[];
    offerId: string;
    expectedDocumentId: string;
  },
): Promise<AgreementPdfDocument> {
  const [producerRow] = await db
    .select({
      contractUrl: privateOffers.agreementPdfContract,
      commercialDraft: privateOffers.commercialDraft,
    })
    .from(privateOffers)
    .innerJoin(
      producers,
      and(eq(producers.id, privateOffers.producerId), eq(producers.clerkUserId, input.clerkUserId)),
    )
    .where(eq(privateOffers.id, input.offerId))
    .limit(1);
  if (producerRow) {
    const document = exactDocumentForAcceptedSnapshot(
      producerRow.contractUrl,
      producerRow.commercialDraft,
      input.expectedDocumentId,
    );
    return document;
  }

  if (input.verifiedEmailHashes.length === 0) unavailable();
  const [artistRow] = await db
    .select({
      contractUrl: privateOffers.agreementPdfContract,
      commercialDraft: privateOffers.commercialDraft,
    })
    .from(privateOffers)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, privateOffers.clientContactId),
        eq(clientContacts.producerId, privateOffers.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        inArray(privateOffers.recipientEmailHash, input.verifiedEmailHashes),
        isNull(clientContacts.archivedAt),
      ),
    )
    .where(and(eq(privateOffers.id, input.offerId), eq(privateOffers.status, "sent")))
    .limit(1);
  if (!artistRow) unavailable();
  const document = exactDocumentForAcceptedSnapshot(
    artistRow.contractUrl,
    artistRow.commercialDraft,
    input.expectedDocumentId,
  );
  return document;
}
