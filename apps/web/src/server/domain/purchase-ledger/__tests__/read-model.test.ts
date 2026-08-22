import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { describe, expect, it } from "vitest";

import {
  activeDownloadOverrides,
  buildPaymentReadModel,
  loadArtistPaymentReadModel,
  loadProducerPaymentReadModel,
  type PaymentLedgerReadRepository,
  type PaymentLedgerReadSnapshot,
  type PaymentReadPurchaseRecord,
} from "../read-model";

describe("SK-44 active exact-version delivery overrides", () => {
  it("keeps only the latest enabled still-stored version state", () => {
    expect(
      activeDownloadOverrides([
        {
          id: "v1-enable",
          purchaseId: "purchase-1",
          producerId: "producer-1",
          versionId: "version-1",
          versionLabel: "V1",
          sequence: 1,
          enabled: true,
          audioDeletedAt: null,
          createdAt: new Date("2026-07-20T09:00:00.000Z"),
        },
        {
          id: "v1-disable",
          purchaseId: "purchase-1",
          producerId: "producer-1",
          versionId: "version-1",
          versionLabel: "V1",
          sequence: 2,
          enabled: false,
          audioDeletedAt: null,
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
        },
        {
          id: "v2-enable",
          purchaseId: "purchase-1",
          producerId: "producer-1",
          versionId: "version-2",
          versionLabel: "V2",
          sequence: 1,
          enabled: true,
          audioDeletedAt: null,
          createdAt: new Date("2026-07-20T11:00:00.000Z"),
        },
        {
          id: "deleted-enable",
          purchaseId: "purchase-1",
          producerId: "producer-1",
          versionId: "version-deleted",
          versionLabel: "Deleted V3",
          sequence: 1,
          enabled: true,
          audioDeletedAt: new Date("2026-07-20T12:00:00.000Z"),
          createdAt: new Date("2026-07-20T11:30:00.000Z"),
        },
      ]),
    ).toEqual([{ versionId: "version-2", versionLabel: "V2" }]);
  });
});

const AS_OF = new Date("2026-07-20T12:00:00.000Z");

function terms(
  name: string,
  currency: string,
  totalCents: number,
  selectedPaymentPlan: PurchaseCommercialSnapshot["selectedPaymentPlan"],
): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: name,
    deliverables: [`${name} master`],
    lineItems: [
      {
        label: name,
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
    currency,
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: null,
    rights: ["Artist owns the approved master"],
    selectedPaymentPlan,
    offeredPaymentPlans: selectedPaymentPlan ? [selectedPaymentPlan] : [],
    agreementText: `Frozen agreement for ${name}`,
  };
}

function purchase(input: {
  id: string;
  projectId: string;
  name: string;
  currency: string;
  totalCents: number;
  lifecycleStatus?: PaymentReadPurchaseRecord["lifecycleStatus"];
  paymentPlanKind?: PaymentReadPurchaseRecord["paymentPlanKind"];
  acceptedAt?: Date;
}): PaymentReadPurchaseRecord & { acceptedAt: Date; sourceKind: "store_product" } {
  const paymentPlanKind = input.paymentPlanKind ?? "full";
  const snapshot = terms(
    input.name,
    input.currency,
    input.totalCents,
    paymentPlanKind === "full"
      ? { kind: "full" }
      : paymentPlanKind === "split_50_50"
        ? { kind: "split_50_50" }
        : { kind: "monthly", installments: 2 },
  );
  const acceptedAt = input.acceptedAt ?? new Date("2026-07-01T09:00:00.000Z");
  return {
    id: input.id,
    producerId: "producer-1",
    projectId: input.projectId,
    clientContactId: "client-1",
    refNumber: `SK-${input.id}`,
    sourceKind: "store_product",
    lifecycleStatus: input.lifecycleStatus ?? "active",
    paymentPlanKind,
    commercialSnapshot: snapshot,
    snapshotDigest: `digest-${input.id}`,
    subtotalCents: input.totalCents,
    taxCents: 0,
    totalCents: input.totalCents,
    currency: input.currency,
    acceptedAt,
    commercialEstablishedAt: acceptedAt,
    activatedAt:
      input.lifecycleStatus === "waiting_for_payment" ? null : new Date(acceptedAt.getTime()),
    canceledAt: input.lifecycleStatus === "canceled" ? new Date("2026-07-10T09:00:00.000Z") : null,
    createdAt: acceptedAt,
  };
}

function snapshotFor(
  purchases: readonly PaymentReadPurchaseRecord[],
  overrides: Partial<PaymentLedgerReadSnapshot> = {},
): PaymentLedgerReadSnapshot {
  const projectIds = [...new Set(purchases.map((row) => row.projectId))];
  return {
    scope: { kind: "producer", producerId: "producer-1" },
    producers: [
      {
        id: "producer-1",
        displayName: "Gili Studio",
        timeZone: "UTC",
        paymentDetails: {
          bankTransfer: "Bank 10 · account 123",
          note: "Use the purchase reference",
        },
      },
    ],
    clients: [
      {
        id: "client-1",
        producerId: "producer-1",
        name: "Maya Artist",
        clerkUserId: "artist-1",
        archivedAt: null,
      },
    ],
    projects: projectIds.map((id, index) => ({
      id,
      producerId: "producer-1",
      clientContactId: "client-1",
      title: index === 0 ? "Archived EP" : "Current single",
      lifecycleStatus: index === 0 ? ("completed" as const) : ("active" as const),
      createdAt: new Date(`2026-0${String(index + 5)}-01T09:00:00.000Z`),
    })),
    purchases,
    acceptances: purchases.flatMap((row) =>
      row.sourceKind !== "imported_existing_work" && row.acceptedAt
        ? [
            {
              id: `acceptance-${row.id}`,
              purchaseId: row.id,
              producerId: row.producerId,
              clientContactId: row.clientContactId,
              acceptedSnapshot: row.commercialSnapshot,
              snapshotDigest: row.snapshotDigest,
              acceptedAt: row.acceptedAt,
            },
          ]
        : [],
    ),
    importAttestations: [],
    installments: [],
    payments: [],
    corrections: [],
    waivers: [],
    proofs: [],
    cancellations: [],
    pauseEvents: [],
    downloadOverrides: [],
    ...overrides,
  };
}

describe("SK-69 payment read model", () => {
  it("returns honest producer-import provenance without Artist acceptance fields", () => {
    const establishedAt = new Date("2026-07-01T09:00:00.000Z");
    const accepted = purchase({
      id: "imported-purchase",
      projectId: "project-imported",
      name: "Existing agreement",
      currency: "USD",
      totalCents: 10_000,
      lifecycleStatus: "waiting_for_payment",
    });
    const imported: PaymentReadPurchaseRecord = {
      ...accepted,
      sourceKind: "imported_existing_work",
      acceptedAt: null,
      commercialEstablishedAt: establishedAt,
      createdAt: establishedAt,
    };
    const data = snapshotFor([imported], {
      acceptances: [],
      importAttestations: [
        {
          id: "attestation-imported-purchase",
          purchaseId: imported.id,
          producerId: imported.producerId,
          clientContactId: imported.clientContactId,
          importedSnapshot: imported.commercialSnapshot,
          snapshotDigest: imported.snapshotDigest,
          importedAt: establishedAt,
        },
      ],
      installments: [
        {
          id: "imported-installment",
          purchaseId: imported.id,
          producerId: imported.producerId,
          position: 1,
          amountCents: imported.totalCents,
          currency: imported.currency,
          dueTrigger: "producer_import",
          dueAt: establishedAt,
          triggeredAt: establishedAt,
          requiredForActivation: true,
          status: "not_paid",
          remindersEnabled: false,
        },
      ],
    });

    const model = buildPaymentReadModel(data, AS_OF);
    const projection = Object.values(model.producerBuckets)
      .flatMap((bucket) => bucket.projects)
      .flatMap((project) => project.purchases)
      .find((candidate) => candidate.id === imported.id);

    expect(projection?.provenance).toEqual({
      kind: "producer_import",
      id: "attestation-imported-purchase",
      importedAt: establishedAt,
      importedSnapshot: imported.commercialSnapshot,
      notice: "Added by producer from an existing agreement",
    });
    expect(projection?.provenance).not.toHaveProperty("acceptedAt");
    expect(projection?.provenance).not.toHaveProperty("acceptedSnapshot");
  });

  it("keeps currencies separate and shows Due now apart from Total remaining", () => {
    const usd = purchase({
      id: "purchase-usd",
      projectId: "project-archived",
      name: "EP production",
      currency: "USD",
      totalCents: 10_000,
      paymentPlanKind: "split_50_50",
    });
    const ils = purchase({
      id: "purchase-ils",
      projectId: "project-current",
      name: "Single production",
      currency: "ILS",
      totalCents: 20_000,
    });
    const data = snapshotFor([usd, ils], {
      installments: [
        {
          id: "usd-1",
          purchaseId: usd.id,
          producerId: usd.producerId,
          position: 1,
          amountCents: 5_000,
          currency: "USD",
          dueTrigger: "acceptance",
          dueAt: new Date("2026-07-01T09:00:00.000Z"),
          triggeredAt: usd.acceptedAt,
          requiredForActivation: true,
          status: "partially_paid",
          remindersEnabled: true,
        },
        {
          id: "usd-2",
          purchaseId: usd.id,
          producerId: usd.producerId,
          position: 2,
          amountCents: 5_000,
          currency: "USD",
          dueTrigger: "artist_approval",
          dueAt: null,
          triggeredAt: null,
          requiredForActivation: false,
          status: "not_paid",
          remindersEnabled: true,
        },
        {
          id: "ils-1",
          purchaseId: ils.id,
          producerId: ils.producerId,
          position: 1,
          amountCents: 20_000,
          currency: "ILS",
          dueTrigger: "monthly_anniversary",
          dueAt: new Date("2026-08-01T09:00:00.000Z"),
          triggeredAt: new Date("2026-08-01T09:00:00.000Z"),
          requiredForActivation: true,
          status: "not_paid",
          remindersEnabled: true,
        },
      ],
      payments: [
        {
          id: "payment-usd",
          purchaseId: usd.id,
          installmentId: "usd-1",
          producerId: usd.producerId,
          proofId: null,
          source: "manual",
          amountCents: 2_000,
          currency: "USD",
          paidAt: new Date("2026-07-02T09:00:00.000Z"),
          note: null,
          createdAt: new Date("2026-07-02T09:00:00.000Z"),
        },
      ],
      corrections: [
        {
          id: "correction-usd",
          purchaseId: usd.id,
          paymentId: "payment-usd",
          producerId: usd.producerId,
          sequence: 1,
          previousAmountCents: 2_000,
          newAmountCents: 1_500,
          reason: "Corrected transfer amount",
          createdAt: new Date("2026-07-03T09:00:00.000Z"),
        },
      ],
      waivers: [
        {
          id: "waiver-usd",
          purchaseId: usd.id,
          installmentId: "usd-2",
          producerId: usd.producerId,
          amountCents: 1_000,
          reason: "Goodwill waiver",
          createdAt: new Date("2026-07-04T09:00:00.000Z"),
        },
      ],
    });

    const model = buildPaymentReadModel(data, AS_OF);

    expect(model.totals).toEqual([
      {
        currency: "ILS",
        purchaseTotalCents: 20_000,
        dueNowCents: 0,
        totalRemainingCents: 20_000,
      },
      {
        currency: "USD",
        purchaseTotalCents: 10_000,
        dueNowCents: 3_500,
        totalRemainingCents: 7_500,
      },
    ]);
    expect(model.producerBuckets.due_or_overdue.projects[0]?.id).toBe("project-archived");
    expect(model.producerBuckets.upcoming.projects[0]?.id).toBe("project-current");
    expect(model.projects.find((project) => project.id === "project-archived")?.totals).toEqual([
      {
        currency: "USD",
        purchaseTotalCents: 10_000,
        dueNowCents: 3_500,
        totalRemainingCents: 7_500,
      },
    ]);
  });

  it("moves fully paid and canceled purchases to History without erasing canceled debt", () => {
    const paid = purchase({
      id: "paid",
      projectId: "project-history",
      name: "Paid mix",
      currency: "USD",
      totalCents: 1_000,
    });
    const canceled = purchase({
      id: "canceled",
      projectId: "project-history",
      name: "Canceled production",
      currency: "USD",
      totalCents: 2_000,
      lifecycleStatus: "canceled",
      paymentPlanKind: "split_50_50",
    });
    if (!canceled.canceledAt) throw new Error("Canceled purchase fixture needs a timestamp");
    const data = snapshotFor([paid, canceled], {
      projects: [
        {
          id: "project-history",
          producerId: "producer-1",
          clientContactId: "client-1",
          title: "History project",
          lifecycleStatus: "completed",
          createdAt: new Date("2026-05-01T09:00:00.000Z"),
        },
      ],
      installments: [
        {
          id: "paid-1",
          purchaseId: paid.id,
          producerId: paid.producerId,
          position: 1,
          amountCents: 1_000,
          currency: "USD",
          dueTrigger: "acceptance",
          dueAt: paid.acceptedAt,
          triggeredAt: paid.acceptedAt,
          requiredForActivation: true,
          status: "confirmed",
          remindersEnabled: true,
        },
        {
          id: "canceled-1",
          purchaseId: canceled.id,
          producerId: canceled.producerId,
          position: 1,
          amountCents: 1_000,
          currency: "USD",
          dueTrigger: "acceptance",
          dueAt: canceled.acceptedAt,
          triggeredAt: canceled.acceptedAt,
          requiredForActivation: true,
          status: "overdue",
          remindersEnabled: true,
        },
        {
          id: "canceled-2",
          purchaseId: canceled.id,
          producerId: canceled.producerId,
          position: 2,
          amountCents: 1_000,
          currency: "USD",
          dueTrigger: "artist_approval",
          dueAt: null,
          triggeredAt: null,
          requiredForActivation: false,
          status: "canceled",
          remindersEnabled: false,
        },
      ],
      payments: [
        {
          id: "paid-payment",
          purchaseId: paid.id,
          installmentId: "paid-1",
          producerId: paid.producerId,
          proofId: null,
          source: "manual",
          amountCents: 1_000,
          currency: "USD",
          paidAt: new Date("2026-07-02T09:00:00.000Z"),
          note: null,
          createdAt: new Date("2026-07-02T09:00:00.000Z"),
        },
      ],
      cancellations: [
        {
          id: "cancel-event",
          purchaseId: canceled.id,
          producerId: canceled.producerId,
          reason: "Work stopped after the first milestone",
          canceledAt: canceled.canceledAt,
        },
      ],
    });

    const model = buildPaymentReadModel(data, AS_OF);
    const history = model.producerBuckets.history.projects[0]?.purchases ?? [];

    expect(history.map((row) => row.id)).toEqual(["paid", "canceled"]);
    expect(history.find((row) => row.id === "paid")?.fullyPaid).toBe(true);
    expect(history.find((row) => row.id === "canceled")).toMatchObject({
      dueNowCents: 1_000,
      totalRemainingCents: 1_000,
      collection: "history",
      showPayNextPayment: false,
    });
    expect(model.totals).toEqual([
      {
        currency: "USD",
        purchaseTotalCents: 3_000,
        dueNowCents: 1_000,
        totalRemainingCents: 1_000,
      },
    ]);
  });

  it("routes a pending proof to Needs review without offering a duplicate payment", () => {
    const waiting = purchase({
      id: "waiting",
      projectId: "project-waiting",
      name: "Waiting production",
      currency: "USD",
      totalCents: 5_000,
      lifecycleStatus: "waiting_for_payment",
    });
    const data = snapshotFor([waiting], {
      installments: [
        {
          id: "waiting-1",
          purchaseId: waiting.id,
          producerId: waiting.producerId,
          position: 1,
          amountCents: 5_000,
          currency: "USD",
          dueTrigger: "acceptance",
          dueAt: waiting.acceptedAt,
          triggeredAt: waiting.acceptedAt,
          requiredForActivation: true,
          status: "awaiting_review",
          remindersEnabled: true,
        },
      ],
      proofs: [
        {
          id: "proof-pending",
          purchaseId: waiting.id,
          installmentId: "waiting-1",
          producerId: waiting.producerId,
          projectId: waiting.projectId,
          clientContactId: waiting.clientContactId,
          replacesProofId: null,
          amountCents: 5_000,
          currency: "USD",
          originalFileName: "private-transfer.pdf",
          status: "pending",
          note: null,
          rejectionNote: null,
          confirmedAt: null,
          rejectedAt: null,
          createdAt: new Date("2026-07-19T09:00:00.000Z"),
        },
      ],
    });

    const model = buildPaymentReadModel(data, AS_OF);
    const row = model.projects[0]?.purchases[0];

    expect(row).toMatchObject({
      producerBucket: "needs_review",
      artistBucket: "waiting",
      dueNowCents: 0,
      totalRemainingCents: 5_000,
      showPayNextPayment: false,
    });
    expect(model.producerBuckets.needs_review.projects).toHaveLength(1);
    expect(model.artistBuckets.waiting.projects).toHaveLength(1);
  });

  it("does not treat a waiver as a confirmed full payment", () => {
    const waived = purchase({
      id: "waived",
      projectId: "project-waived",
      name: "Waived balance",
      currency: "USD",
      totalCents: 1_000,
    });
    const model = buildPaymentReadModel(
      snapshotFor([waived], {
        installments: [
          {
            id: "waived-1",
            purchaseId: waived.id,
            producerId: waived.producerId,
            position: 1,
            amountCents: 1_000,
            currency: "USD",
            dueTrigger: "acceptance",
            dueAt: waived.acceptedAt,
            triggeredAt: waived.acceptedAt,
            requiredForActivation: true,
            status: "waived",
            remindersEnabled: false,
          },
        ],
        waivers: [
          {
            id: "waived-event",
            purchaseId: waived.id,
            installmentId: "waived-1",
            producerId: waived.producerId,
            amountCents: 1_000,
            reason: "Producer waived the balance",
            createdAt: AS_OF,
          },
        ],
      }),
      AS_OF,
    );

    expect(model.projects[0]?.purchases[0]).toMatchObject({
      paidCents: 0,
      waivedCents: 1_000,
      totalRemainingCents: 0,
      fullyPaid: false,
      collection: "active",
      producerBucket: "upcoming",
    });
    expect(model.producerBuckets.history.projects).toHaveLength(0);
  });

  it("fails closed for foreign money rows and artist ownership drift", () => {
    const owned = purchase({
      id: "owned",
      projectId: "project-owned",
      name: "Owned work",
      currency: "USD",
      totalCents: 1_000,
    });
    const base = snapshotFor([owned], {
      installments: [
        {
          id: "owned-1",
          purchaseId: owned.id,
          producerId: owned.producerId,
          position: 1,
          amountCents: 1_000,
          currency: "USD",
          dueTrigger: "acceptance",
          dueAt: owned.acceptedAt,
          triggeredAt: owned.acceptedAt,
          requiredForActivation: true,
          status: "not_paid",
          remindersEnabled: true,
        },
      ],
    });
    const foreign = {
      ...base,
      payments: [
        {
          id: "foreign-payment",
          purchaseId: owned.id,
          installmentId: "owned-1",
          producerId: "producer-foreign",
          proofId: null,
          source: "manual" as const,
          amountCents: 100,
          currency: "USD",
          paidAt: AS_OF,
          note: null,
          createdAt: AS_OF,
        },
      ],
    } satisfies PaymentLedgerReadSnapshot;

    expect(() => buildPaymentReadModel(foreign, AS_OF)).toThrow(/scope|producer/i);
    expect(() =>
      buildPaymentReadModel(
        {
          ...base,
          scope: { kind: "artist", clerkUserId: "different-artist" },
        },
        AS_OF,
      ),
    ).toThrow(/artist ownership/i);
  });

  it("derives repository scopes only from authenticated loader inputs", async () => {
    const seen: PaymentLedgerReadSnapshot["scope"][] = [];
    const repository: PaymentLedgerReadRepository = {
      loadSnapshot: (scope) => {
        seen.push(scope);
        return Promise.resolve(snapshotFor([], { scope }));
      },
    };

    await loadProducerPaymentReadModel(repository, {
      producerId: "producer-1",
      projectId: "project-1",
      asOf: AS_OF,
    });
    await loadArtistPaymentReadModel(repository, { clerkUserId: "artist-1", asOf: AS_OF });

    expect(seen).toEqual([
      { kind: "producer", producerId: "producer-1", projectId: "project-1" },
      { kind: "artist", clerkUserId: "artist-1" },
    ]);
  });
});
