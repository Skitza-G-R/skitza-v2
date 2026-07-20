import { describe, expect, it } from "vitest";

import {
  projectPurchaseLedger,
  PurchaseLedgerDomainError,
  type LedgerInstallmentInput,
  type LedgerPaymentInput,
} from "../policy";

const purchase = {
  id: "purchase-a",
  producerId: "producer-a",
  currency: "USD",
  lifecycleStatus: "active" as const,
  wasActivated: true,
};

const installments: LedgerInstallmentInput[] = [
  {
    id: "installment-1",
    purchaseId: purchase.id,
    producerId: purchase.producerId,
    position: 1,
    amountCents: 5_000,
    currency: "USD",
    dueAt: new Date("2026-01-01T10:00:00.000Z"),
    requiredForActivation: true,
    status: "confirmed",
  },
  {
    id: "installment-2",
    purchaseId: purchase.id,
    producerId: purchase.producerId,
    position: 2,
    amountCents: 5_000,
    currency: "USD",
    dueAt: new Date("2026-02-01T10:00:00.000Z"),
    requiredForActivation: false,
    status: "not_paid",
  },
];

function payment(id: string, installmentId: string, amountCents: number): LedgerPaymentInput {
  return {
    id,
    purchaseId: purchase.id,
    installmentId,
    producerId: purchase.producerId,
    amountCents,
    currency: purchase.currency,
  };
}

function project(overrides: Partial<Parameters<typeof projectPurchaseLedger>[0]> = {}) {
  return projectPurchaseLedger({
    purchase,
    installments,
    payments: [],
    corrections: [],
    waivers: [],
    asOf: new Date("2026-01-15T10:00:00.000Z"),
    timeZone: "UTC",
    ...overrides,
  });
}

describe("exact purchase ledger projection", () => {
  it("never moves one installment's overpayment to its sibling", () => {
    const result = project({ payments: [payment("payment-1", "installment-1", 12_000)] });

    expect(result.paidCents).toBe(12_000);
    expect(result.overpaidCents).toBe(7_000);
    expect(result.remainingCents).toBe(5_000);
    expect(result.fullyPaidForDownloads).toBe(false);
    expect(
      result.installments.map(({ paidCents, remainingCents }) => [paidCents, remainingCents]),
    ).toEqual([
      [12_000, 0],
      [0, 5_000],
    ]);
  });

  it("relocks downloads after a downward correction without losing activation history", () => {
    const result = project({
      payments: [
        payment("payment-1", "installment-1", 5_000),
        payment("payment-2", "installment-2", 5_000),
      ],
      corrections: [
        {
          id: "correction-1",
          purchaseId: purchase.id,
          paymentId: "payment-2",
          producerId: purchase.producerId,
          sequence: 1,
          previousAmountCents: 5_000,
          newAmountCents: 1_000,
        },
      ],
    });

    expect(result.activationRemainsSatisfied).toBe(true);
    expect(result.fullyPaidForDownloads).toBe(false);
    expect(result.remainingCents).toBe(4_000);
  });

  it("settles waived debt without treating it as paid or unlocking downloads", () => {
    const result = project({
      payments: [payment("payment-1", "installment-1", 5_000)],
      waivers: [
        {
          id: "waiver-1",
          purchaseId: purchase.id,
          installmentId: "installment-2",
          producerId: purchase.producerId,
          amountCents: 5_000,
        },
      ],
    });

    expect(result.settled).toBe(true);
    expect(result.waivedCents).toBe(5_000);
    expect(result.fullyPaidForDownloads).toBe(false);
    expect(result.installments[1]?.status).toBe("waived");
  });

  it("reports confirmed money above waiver-adjusted debt as overpayment", () => {
    const result = project({
      payments: [payment("payment-1", "installment-1", 5_000)],
      waivers: [
        {
          id: "waiver-1",
          purchaseId: purchase.id,
          installmentId: "installment-1",
          producerId: purchase.producerId,
          amountCents: 2_500,
        },
      ],
    });

    expect(result.installments[0]?.overpaidCents).toBe(2_500);
    expect(result.overpaidCents).toBe(2_500);
  });

  it("keeps a canceled purchase downloadable when every exact installment was paid", () => {
    const result = project({
      purchase: { ...purchase, lifecycleStatus: "canceled" },
      payments: [
        payment("payment-1", "installment-1", 5_000),
        payment("payment-2", "installment-2", 5_000),
      ],
    });

    expect(result.fullyPaidForDownloads).toBe(true);
  });

  it("shows a partially paid balance as overdue after its local due date", () => {
    const result = project({ payments: [payment("payment-1", "installment-1", 1_000)] });
    expect(result.installments[0]?.status).toBe("overdue");
    expect(result.installments[0]?.remainingCents).toBe(4_000);
  });

  it("keeps awaiting review visible ahead of overdue", () => {
    const result = project({ pendingProofInstallmentIds: ["installment-1"] });
    expect(result.installments[0]?.status).toBe("awaiting_review");
  });

  it("rejects cross-currency and cross-purchase money instead of aggregating it", () => {
    for (const badPayment of [
      { ...payment("payment-x", "installment-1", 100), currency: "EUR" },
      { ...payment("payment-x", "installment-1", 100), purchaseId: "purchase-b" },
    ]) {
      expect(() => project({ payments: [badPayment] })).toThrow(PurchaseLedgerDomainError);
    }
  });
});
