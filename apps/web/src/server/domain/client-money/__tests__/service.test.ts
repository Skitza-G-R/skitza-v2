import { describe, expect, it } from "vitest";

import {
  loadClientMoneyHistory,
  type ClientMoneyRepository,
  type ClientMoneySnapshot,
} from "../service";

const at = (value: string) => new Date(value);

function snapshot(): ClientMoneySnapshot {
  return {
    client: { id: "client-1", producerId: "producer-1" },
    projects: [
      {
        id: "project-usd",
        producerId: "producer-1",
        clientContactId: "client-1",
        title: "USD album",
        lifecycleStatus: "active",
        createdAt: at("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "project-eur",
        producerId: "producer-1",
        clientContactId: "client-1",
        title: "EUR single",
        lifecycleStatus: "completed",
        createdAt: at("2026-02-01T00:00:00.000Z"),
      },
      {
        id: "project-empty",
        producerId: "producer-1",
        clientContactId: "client-1",
        title: "Empty project",
        lifecycleStatus: "canceled",
        createdAt: at("2025-12-01T00:00:00.000Z"),
      },
    ],
    purchases: [
      {
        id: "purchase-usd-paid",
        producerId: "producer-1",
        projectId: "project-usd",
        clientContactId: "client-1",
        refNumber: "SK-USD-1",
        sourceKind: "store_product",
        lifecycleStatus: "active",
        paymentPlanKind: "full",
        commercialSnapshot: {
          productOrOfferName: "Album production",
          subtotalCents: 10_000,
          tax: { amountCents: 0 },
          totalCents: 10_000,
          currency: "USD",
        },
        subtotalCents: 10_000,
        taxCents: 0,
        totalCents: 10_000,
        currency: "USD",
        acceptedAt: at("2026-01-02T00:00:00.000Z"),
        activatedAt: at("2026-01-03T00:00:00.000Z"),
        canceledAt: null,
      },
      {
        id: "purchase-usd-unpaid",
        producerId: "producer-1",
        projectId: "project-usd",
        clientContactId: "client-1",
        refNumber: "SK-USD-2",
        sourceKind: "paid_add_on",
        lifecycleStatus: "waiting_for_payment",
        paymentPlanKind: "full",
        commercialSnapshot: {
          productOrOfferName: "Extra song",
          subtotalCents: 5_000,
          tax: { amountCents: 0 },
          totalCents: 5_000,
          currency: "USD",
        },
        subtotalCents: 5_000,
        taxCents: 0,
        totalCents: 5_000,
        currency: "USD",
        acceptedAt: at("2026-01-04T00:00:00.000Z"),
        activatedAt: null,
        canceledAt: null,
      },
      {
        id: "purchase-eur",
        producerId: "producer-1",
        projectId: "project-eur",
        clientContactId: "client-1",
        refNumber: "SK-EUR-1",
        sourceKind: "private_offer",
        lifecycleStatus: "active",
        paymentPlanKind: "full",
        commercialSnapshot: {
          productOrOfferName: "Mix and master",
          subtotalCents: 9_000,
          tax: { amountCents: 0 },
          totalCents: 9_000,
          currency: "EUR",
        },
        subtotalCents: 9_000,
        taxCents: 0,
        totalCents: 9_000,
        currency: "EUR",
        acceptedAt: at("2026-02-02T00:00:00.000Z"),
        activatedAt: at("2026-02-03T00:00:00.000Z"),
        canceledAt: null,
      },
    ],
    installments: [
      {
        id: "installment-usd-paid",
        purchaseId: "purchase-usd-paid",
        producerId: "producer-1",
        position: 1,
        amountCents: 10_000,
        currency: "USD",
        dueTrigger: "acceptance",
        dueAt: at("2026-01-02T00:00:00.000Z"),
        triggeredAt: at("2026-01-02T00:00:00.000Z"),
        requiredForActivation: true,
        status: "partially_paid",
        createdAt: at("2026-01-02T00:00:00.000Z"),
      },
      {
        id: "installment-usd-unpaid",
        purchaseId: "purchase-usd-unpaid",
        producerId: "producer-1",
        position: 1,
        amountCents: 5_000,
        currency: "USD",
        dueTrigger: "acceptance",
        dueAt: null,
        triggeredAt: at("2026-01-04T00:00:00.000Z"),
        requiredForActivation: true,
        status: "awaiting_review",
        createdAt: at("2026-01-04T00:00:00.000Z"),
      },
      {
        id: "installment-eur",
        purchaseId: "purchase-eur",
        producerId: "producer-1",
        position: 1,
        amountCents: 9_000,
        currency: "EUR",
        dueTrigger: "acceptance",
        dueAt: at("2026-02-02T00:00:00.000Z"),
        triggeredAt: at("2026-02-02T00:00:00.000Z"),
        requiredForActivation: true,
        status: "confirmed",
        createdAt: at("2026-02-02T00:00:00.000Z"),
      },
    ],
    payments: [
      {
        id: "payment-usd",
        purchaseId: "purchase-usd-paid",
        installmentId: "installment-usd-paid",
        producerId: "producer-1",
        proofId: "proof-confirmed",
        source: "proof",
        amountCents: 8_000,
        currency: "USD",
        paidAt: at("2026-01-03T00:00:00.000Z"),
        note: "Bank transfer",
        createdAt: at("2026-01-03T00:00:00.000Z"),
      },
      {
        id: "payment-eur",
        purchaseId: "purchase-eur",
        installmentId: "installment-eur",
        producerId: "producer-1",
        proofId: null,
        source: "manual",
        amountCents: 9_000,
        currency: "EUR",
        paidAt: at("2026-02-03T00:00:00.000Z"),
        note: null,
        createdAt: at("2026-02-03T00:00:00.000Z"),
      },
    ],
    corrections: [
      {
        id: "correction-usd",
        purchaseId: "purchase-usd-paid",
        paymentId: "payment-usd",
        producerId: "producer-1",
        sequence: 1,
        previousAmountCents: 8_000,
        newAmountCents: 6_000,
        reason: "Partial bank return",
        correctedByClerkUserId: "producer-user-1",
        createdAt: at("2026-01-05T00:00:00.000Z"),
      },
    ],
    waivers: [],
    proofs: [
      {
        id: "proof-confirmed",
        purchaseId: "purchase-usd-paid",
        installmentId: "installment-usd-paid",
        producerId: "producer-1",
        projectId: "project-usd",
        clientContactId: "client-1",
        replacesProofId: null,
        amountCents: 8_000,
        currency: "USD",
        originalFileName: "bank-transfer.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        status: "confirmed",
        note: "Transfer receipt",
        rejectionNote: null,
        confirmedAt: at("2026-01-03T00:00:00.000Z"),
        rejectedAt: null,
        createdAt: at("2026-01-03T00:00:00.000Z"),
      },
      {
        id: "proof-rejected",
        purchaseId: "purchase-usd-unpaid",
        installmentId: "installment-usd-unpaid",
        producerId: "producer-1",
        projectId: "project-usd",
        clientContactId: "client-1",
        replacesProofId: null,
        amountCents: 5_000,
        currency: "USD",
        originalFileName: "cropped.png",
        contentType: "image/png",
        sizeBytes: 200,
        status: "rejected",
        note: null,
        rejectionNote: "Amount is not visible",
        confirmedAt: null,
        rejectedAt: at("2026-01-05T00:00:00.000Z"),
        createdAt: at("2026-01-04T00:00:00.000Z"),
      },
      {
        id: "proof-pending",
        purchaseId: "purchase-usd-unpaid",
        installmentId: "installment-usd-unpaid",
        producerId: "producer-1",
        projectId: "project-usd",
        clientContactId: "client-1",
        replacesProofId: "proof-rejected",
        amountCents: 5_000,
        currency: "USD",
        originalFileName: "replacement.png",
        contentType: "image/png",
        sizeBytes: 300,
        status: "pending",
        note: "Full screenshot",
        rejectionNote: null,
        confirmedAt: null,
        rejectedAt: null,
        createdAt: at("2026-01-06T00:00:00.000Z"),
      },
    ],
  };
}

function repository(value: ClientMoneySnapshot | null): ClientMoneyRepository {
  return { loadSnapshot: () => Promise.resolve(value) };
}

describe("client purchase-owned money history", () => {
  it("groups every purchase, corrected payment, and proof by project without combining currencies", async () => {
    const result = await loadClientMoneyHistory(repository(snapshot()), {
      producerId: "producer-1",
      clientContactId: "client-1",
    });

    expect(result.totals).toEqual([
      { currency: "EUR", purchasedCents: 9_000, paidCents: 9_000, remainingCents: 0 },
      { currency: "USD", purchasedCents: 15_000, paidCents: 6_000, remainingCents: 9_000 },
    ]);

    const usdProject = result.projects.find((project) => project.id === "project-usd");
    expect(usdProject?.purchases).toHaveLength(2);
    expect(usdProject?.totals).toEqual([
      { currency: "USD", purchasedCents: 15_000, paidCents: 6_000, remainingCents: 9_000 },
    ]);

    const paidPurchase = usdProject?.purchases.find(
      (purchase) => purchase.id === "purchase-usd-paid",
    );
    expect(paidPurchase?.ledger).toMatchObject({
      paidCents: 6_000,
      remainingBalanceCents: 4_000,
    });
    expect(paidPurchase?.payments).toEqual([
      expect.objectContaining({
        id: "payment-usd",
        originalAmountCents: 8_000,
        effectiveAmountCents: 6_000,
        installmentPosition: 1,
        proofId: "proof-confirmed",
        corrections: [
          expect.objectContaining({
            id: "correction-usd",
            previousAmountCents: 8_000,
            newAmountCents: 6_000,
          }),
        ],
      }),
    ]);
    expect(paidPurchase?.proofs).toEqual([
      expect.objectContaining({
        id: "proof-confirmed",
        status: "confirmed",
        installmentPosition: 1,
        originalFileName: "bank-transfer.pdf",
      }),
    ]);

    const unpaidPurchase = usdProject?.purchases.find(
      (purchase) => purchase.id === "purchase-usd-unpaid",
    );
    expect(unpaidPurchase?.payments).toEqual([]);
    expect(unpaidPurchase?.proofs.map((proof) => proof.status).sort()).toEqual([
      "pending",
      "rejected",
    ]);
    expect(unpaidPurchase?.ledger.paidCents).toBe(0);
    expect(unpaidPurchase?.ledger.remainingBalanceCents).toBe(5_000);

    expect(result.projects.find((project) => project.id === "project-empty")).toMatchObject({
      purchases: [],
      totals: [],
    });
  });

  it("returns the same NOT_FOUND result for missing and foreign clients", async () => {
    for (const value of [
      null,
      { ...snapshot(), client: { id: "client-1", producerId: "producer-2" } },
    ]) {
      await expect(
        loadClientMoneyHistory(repository(value), {
          producerId: "producer-1",
          clientContactId: "client-1",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "The client was not found",
      });
    }
  });

  it("keeps waivers separate from paid money while reducing collectible remaining debt", async () => {
    const value = snapshot();
    value.waivers.push({
      id: "waiver-usd",
      purchaseId: "purchase-usd-unpaid",
      installmentId: "installment-usd-unpaid",
      producerId: "producer-1",
      amountCents: 1_000,
      reason: "Producer goodwill",
      waivedByClerkUserId: "producer-user-1",
      createdAt: at("2026-01-07T00:00:00.000Z"),
    });

    const result = await loadClientMoneyHistory(repository(value), {
      producerId: "producer-1",
      clientContactId: "client-1",
    });
    const purchase = result.projects
      .flatMap((project) => project.purchases)
      .find((candidate) => candidate.id === "purchase-usd-unpaid");

    expect(purchase?.ledger).toMatchObject({
      paidCents: 0,
      appliedWaiverCents: 1_000,
      remainingBalanceCents: 4_000,
    });
    expect(purchase?.waivers).toEqual([
      expect.objectContaining({
        id: "waiver-usd",
        installmentPosition: 1,
        amountCents: 1_000,
      }),
    ]);
    expect(result.totals.find((total) => total.currency === "USD")).toEqual({
      currency: "USD",
      purchasedCents: 15_000,
      paidCents: 6_000,
      remainingCents: 8_000,
    });
  });

  it("preserves canceled and zero-charge purchase history with every payment and proof", async () => {
    const value = snapshot();
    const paidPurchase = value.purchases.find(
      (purchase) => purchase.id === "purchase-usd-paid",
    );
    const paidInstallment = value.installments.find(
      (installment) => installment.id === "installment-usd-paid",
    );
    if (!paidPurchase || !paidInstallment) {
      throw new Error("Fixture must include the paid purchase and installment");
    }
    value.purchases[value.purchases.indexOf(paidPurchase)] = {
      ...paidPurchase,
      lifecycleStatus: "canceled",
      canceledAt: at("2026-01-08T00:00:00.000Z"),
    };
    value.installments[value.installments.indexOf(paidInstallment)] = {
      ...paidInstallment,
      status: "canceled",
    };
    value.purchases.push({
      id: "purchase-free",
      producerId: "producer-1",
      projectId: "project-empty",
      clientContactId: "client-1",
      refNumber: "SK-FREE-1",
      sourceKind: "no_charge_add_on",
      lifecycleStatus: "canceled",
      paymentPlanKind: null,
      commercialSnapshot: {
        productOrOfferName: "Complimentary revision",
        subtotalCents: 0,
        tax: { amountCents: 0 },
        totalCents: 0,
        currency: "USD",
      },
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      currency: "USD",
      acceptedAt: at("2026-01-09T00:00:00.000Z"),
      activatedAt: at("2026-01-09T00:00:00.000Z"),
      canceledAt: at("2026-01-10T00:00:00.000Z"),
    });

    const result = await loadClientMoneyHistory(repository(value), {
      producerId: "producer-1",
      clientContactId: "client-1",
    });
    const purchases = result.projects.flatMap((project) => project.purchases);
    const canceled = purchases.find((purchase) => purchase.id === "purchase-usd-paid");
    const free = purchases.find((purchase) => purchase.id === "purchase-free");

    expect(purchases).toHaveLength(value.purchases.length);
    expect(canceled).toMatchObject({ lifecycleStatus: "canceled" });
    expect(canceled?.payments).toHaveLength(1);
    expect(canceled?.proofs).toHaveLength(1);
    expect(free).toMatchObject({
      lifecycleStatus: "canceled",
      totalCents: 0,
      installments: [],
      payments: [],
      proofs: [],
      ledger: {
        paidCents: 0,
        remainingBalanceCents: 0,
        settled: true,
      },
    });
  });

  it("fails closed when child rows escape the stable owner boundary", async () => {
    const value = snapshot();
    const firstProof = value.proofs[0];
    if (!firstProof) throw new Error("Fixture must include a proof");
    value.proofs[0] = { ...firstProof, clientContactId: "client-2" };

    await expect(
      loadClientMoneyHistory(repository(value), {
        producerId: "producer-1",
        clientContactId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  });

  it("fails closed on an invalid immutable correction chain", async () => {
    const value = snapshot();
    const firstCorrection = value.corrections[0];
    if (!firstCorrection) throw new Error("Fixture must include a correction");
    value.corrections[0] = { ...firstCorrection, previousAmountCents: 7_000 };

    await expect(
      loadClientMoneyHistory(repository(value), {
        producerId: "producer-1",
        clientContactId: "client-1",
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  });
});
