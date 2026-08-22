import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { describe, expect, it } from "vitest";

import type {
  PaymentBucketProjection,
  PaymentPurchaseProjection,
} from "~/server/domain/purchase-ledger/read-model";

import { toPaymentHistoryViewData } from "../payment-history-adapter";

const SECTION = {
  id: "history",
  eyebrow: "Accepted purchases",
  title: "History",
  description: "Complete accepted records.",
  emptyTitle: "No history",
  emptyDescription: "Accepted records appear here.",
} as const;

function commercialSnapshot(
  totalCents: number,
  selectedPaymentPlan: PurchaseCommercialSnapshot["selectedPaymentPlan"],
): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: "Royalty production",
    deliverables: ["Approved master"],
    lineItems: [
      {
        label: "Production",
        quantity: 1,
        listUnitPriceCents: totalCents,
        unitPriceCents: totalCents,
        totalCents,
      },
    ],
    listSubtotalCents: totalCents,
    discountCents: 0,
    subtotalCents: totalCents,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents,
    currency: "ILS",
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: null,
    rights: ["Artist owns the approved master"],
    selectedPaymentPlan,
    offeredPaymentPlans: selectedPaymentPlan ? [selectedPaymentPlan] : [],
    agreementText: "Frozen accepted agreement",
  };
}

function purchase(
  overrides: Partial<PaymentPurchaseProjection> & Pick<PaymentPurchaseProjection, "id">,
): PaymentPurchaseProjection {
  const { id, ...rest } = overrides;
  const snapshot = commercialSnapshot(100_000, { kind: "full" });
  return {
    id,
    producerId: "00000000-0000-4000-8000-000000000201",
    producerName: "North Room",
    projectId: "project-1",
    clientContactId: "client-1",
    clientName: "Maya Cohen",
    refNumber: `SK-${overrides.id}`,
    sourceKind: "private_offer",
    lifecycleStatus: "active",
    paymentPlanKind: "full",
    commercialSnapshot: snapshot,
    provenance: {
      kind: "artist_acceptance",
      id: `acceptance-${overrides.id}`,
      acceptedAt: new Date("2026-07-01T09:00:00.000Z"),
      acceptedSnapshot: snapshot,
    },
    subtotalCents: 100_000,
    taxCents: 0,
    totalCents: 100_000,
    currency: "ILS",
    commercialEstablishedAt: new Date("2026-07-01T09:00:00.000Z"),
    activatedAt: new Date("2026-07-02T09:00:00.000Z"),
    canceledAt: null,
    paidCents: 0,
    waivedCents: 0,
    dueNowCents: 0,
    totalRemainingCents: 100_000,
    overpaidCents: 0,
    fullyPaid: false,
    collection: "active",
    producerBucket: "upcoming",
    artistBucket: "active",
    installments: [],
    nextPayment: null,
    showPayNextPayment: false,
    currentInstructions: null,
    payments: [],
    corrections: [],
    proofs: [],
    waivers: [],
    cancellation: null,
    pauseEvents: [],
    downloadOverrides: [],
    activeDownloadOverrides: [],
    ...rest,
  };
}

function mapPurchase(row: PaymentPurchaseProjection) {
  const bucket = {
    totals: [],
    projects: [
      {
        id: "project-1",
        producerId: row.producerId,
        clientContactId: row.clientContactId,
        title: "Debut single",
        lifecycleStatus: "active",
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
        totals: [],
        purchases: [row],
      },
    ],
  } satisfies PaymentBucketProjection;
  return toPaymentHistoryViewData(bucket, SECTION, "artist").projects[0]?.purchases[0];
}

describe("artist payment record status", () => {
  it("maps imported provenance, due timing, and producer-confirmed money without artist acceptance", () => {
    const snapshot = commercialSnapshot(100_000, { kind: "full" });
    const importedAt = new Date("2026-06-15T09:00:00.000Z");
    const row = mapPurchase(
      purchase({
        id: "imported-work",
        sourceKind: "imported_existing_work",
        commercialSnapshot: snapshot,
        commercialEstablishedAt: importedAt,
        provenance: {
          kind: "producer_import",
          id: "import-attestation-1",
          importedAt,
          importedSnapshot: snapshot,
          notice: "Added by producer from an existing agreement",
        },
        installments: [
          {
            id: "imported-installment-1",
            purchaseId: "imported-work",
            producerId: "00000000-0000-4000-8000-000000000201",
            position: 1,
            amountCents: 100_000,
            currency: "ILS",
            dueTrigger: "producer_import",
            dueAt: importedAt,
            triggeredAt: importedAt,
            requiredForActivation: true,
            status: "partially_paid",
            remindersEnabled: false,
            paidCents: 20_000,
            waivedCents: 0,
            remainingCents: 80_000,
            overpaidCents: 0,
          },
        ],
        payments: [
          {
            id: "imported-payment-1",
            purchaseId: "imported-work",
            installmentId: "imported-installment-1",
            producerId: "00000000-0000-4000-8000-000000000201",
            proofId: null,
            source: "manual",
            amountCents: 20_000,
            effectiveAmountCents: 20_000,
            currency: "ILS",
            paidAt: importedAt,
            note: null,
            createdAt: importedAt,
          },
        ],
      }),
    );

    expect(row?.agreementRecord).toEqual({
      kind: "producer_import",
      establishedAtIso: importedAt.toISOString(),
      headline: "Added by producer from an existing agreement",
      statement: "The outside agreement, price, plan, and schedule above are frozen in Skitza.",
    });
    expect(row?.schedule[0]?.trigger).toBe("When added to Skitza");
    expect(row?.payments[0]?.sourceLabel).toBe("Confirmed by producer");
    expect(JSON.stringify(row)).not.toContain("Maya Cohen accepted the exact terms");
  });

  it("keeps only the accepted PDF file name in the client history model", () => {
    const baseSnapshot = commercialSnapshot(100_000, { kind: "full" });
    const snapshot = {
      ...baseSnapshot,
      agreementPdf: {
        documentId: "00000000-0000-4000-8000-000000000301",
        originalFileName: "frozen-production-terms.pdf",
        contentType: "application/pdf",
        sizeBytes: 1_024,
        objectEtag: "private-object-etag",
        sha256: "a".repeat(64),
      },
    } as PurchaseCommercialSnapshot;
    const row = mapPurchase(
      purchase({
        id: "accepted-pdf",
        commercialSnapshot: snapshot,
        provenance: {
          kind: "artist_acceptance",
          id: "acceptance-pdf",
          acceptedAt: new Date("2026-07-01T09:00:00.000Z"),
          acceptedSnapshot: snapshot,
        },
      }),
    );

    expect(row?.frozenTerms.agreementPdfFileName).toBe("frozen-production-terms.pdf");
    expect(JSON.stringify(row)).not.toContain("private-object-etag");
    expect(JSON.stringify(row)).not.toContain('"sha256"');
  });

  it("does not call a true zero-total accepted purchase paid in full", () => {
    const snapshot = commercialSnapshot(0, null);
    const row = mapPurchase(
      purchase({
        id: "zero-total",
        paymentPlanKind: null,
        commercialSnapshot: snapshot,
        provenance: {
          kind: "artist_acceptance",
          id: "acceptance-zero",
          acceptedAt: new Date("2026-07-01T09:00:00.000Z"),
          acceptedSnapshot: snapshot,
        },
        subtotalCents: 0,
        totalCents: 0,
        paidCents: 0,
        totalRemainingCents: 0,
        fullyPaid: true,
        collection: "history",
        producerBucket: "history",
        artistBucket: "history",
      }),
    );

    expect(row?.recordStatus).toBe("no_payment_required");
    expect(row?.status.label).toBe("No payment required");
  });

  it("keeps canceled and waived zero balances distinct from verified payment", () => {
    const canceled = mapPurchase(
      purchase({
        id: "canceled-zero",
        lifecycleStatus: "canceled",
        canceledAt: new Date("2026-07-10T09:00:00.000Z"),
        totalRemainingCents: 0,
        fullyPaid: true,
        collection: "history",
        producerBucket: "history",
        artistBucket: "history",
      }),
    );
    const waived = mapPurchase(
      purchase({
        id: "waived-zero",
        waivedCents: 100_000,
        totalRemainingCents: 0,
        fullyPaid: false,
      }),
    );

    expect(canceled?.recordStatus).toBe("canceled");
    expect(canceled?.status.label).toBe("Canceled");
    expect(waived?.recordStatus).toBe("settled_by_waiver");
    expect(waived?.status.label).toBe("Settled by waiver");
  });

  it("marks only an actually paid cash total paid in full", () => {
    const paid = mapPurchase(
      purchase({
        id: "paid-cash-total",
        paidCents: 100_000,
        totalRemainingCents: 0,
        fullyPaid: true,
        collection: "history",
        producerBucket: "history",
        artistBucket: "history",
      }),
    );

    expect(paid?.recordStatus).toBe("paid_in_full");
    expect(paid?.status.label).toBe("Paid in full");
  });
});
