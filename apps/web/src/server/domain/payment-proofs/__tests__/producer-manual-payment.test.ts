import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertInstallmentAcceptsManualPayment,
  recordProducerManualPayment,
} from "../producer-manual-payment";
import { PaymentProofDomainError, type InstallmentRow, type LedgerSnapshot } from "../service";

const here = dirname(fileURLToPath(import.meta.url));
const moduleSource = readFileSync(join(here, "..", "producer-manual-payment.ts"), "utf8");
const routerSource = readFileSync(
  join(here, "..", "..", "..", "trpc", "routers", "purchase-ledger.ts"),
  "utf8",
);

const NOW = new Date("2026-08-23T10:00:00.000Z");

function installment(overrides: Partial<InstallmentRow> = {}): InstallmentRow {
  return {
    id: "inst-1",
    purchaseId: "purchase-1",
    producerId: "producer-1",
    position: 1,
    amountCents: 50_000,
    currency: "ILS",
    dueTrigger: "acceptance",
    dueAt: new Date("2026-08-01T00:00:00.000Z"),
    triggeredAt: null,
    requiredForActivation: true,
    status: "not_paid",
    remindersEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function ledger(paid = 0, waived = 0): LedgerSnapshot {
  return {
    paidByInstallment: new Map(paid ? [["inst-1", paid]] : []),
    waivedByInstallment: new Map(waived ? [["inst-1", waived]] : []),
    paidCents: paid,
    waivedCents: waived,
  };
}

const OPEN = {
  context: { lifecycleStatus: "active" as const, producerClosedAt: null },
  installment: installment(),
  ledger: ledger(),
  proofs: [],
  now: NOW,
};

function failure(input: Parameters<typeof assertInstallmentAcceptsManualPayment>[0]): string {
  try {
    assertInstallmentAcceptsManualPayment(input);
  } catch (error) {
    if (error instanceof PaymentProofDomainError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "accepted";
}

describe("assertInstallmentAcceptsManualPayment", () => {
  it("returns what is left on a payable installment", () => {
    expect(assertInstallmentAcceptsManualPayment(OPEN)).toBe(50_000);
    expect(
      assertInstallmentAcceptsManualPayment({
        ...OPEN,
        installment: installment({ status: "partially_paid" }),
        ledger: ledger(20_000, 5_000),
      }),
    ).toBe(25_000);
  });

  it("blocks every state the ledger must not accept money for", () => {
    expect(
      failure({ ...OPEN, context: { lifecycleStatus: "canceled", producerClosedAt: null } }),
    ).toMatch(/canceled purchase/);
    expect(
      failure({ ...OPEN, context: { lifecycleStatus: "active", producerClosedAt: NOW } }),
    ).toMatch(/closed studio/);
    expect(failure({ ...OPEN, proofs: [{ installmentId: "inst-1", status: "pending" }] })).toMatch(
      /proof waiting for review/,
    );
    expect(failure({ ...OPEN, proofs: [{ installmentId: "other", status: "pending" }] })).toBe(
      "accepted",
    );
    expect(failure({ ...OPEN, installment: installment({ status: "confirmed" }) })).toMatch(
      /already settled/,
    );
    expect(failure({ ...OPEN, installment: installment({ status: "waived" }) })).toMatch(
      /already settled/,
    );
    expect(
      failure({
        ...OPEN,
        installment: installment({
          position: 2,
          dueTrigger: "artist_approval",
          dueAt: null,
          requiredForActivation: false,
        }),
      }),
    ).toMatch(/not due yet/);
    expect(failure({ ...OPEN, ledger: ledger(50_000) })).toMatch(/Nothing is left/);
  });
});

describe("recordProducerManualPayment input guards", () => {
  it("rejects a future payment date before touching the database", async () => {
    const db = {
      transaction: () => {
        throw new Error("database must not be reached");
      },
    } as never;
    await expect(
      recordProducerManualPayment(db, {
        producerId: "producer-1",
        clerkUserId: "user_1",
        purchaseId: "purchase-1",
        installmentId: "inst-1",
        operationKey: "0d2b6d0e-5c2a-4a35-9d3c-2b8f2b1c9a10",
        amountCents: 1_000,
        paidAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
        serverSecret: "x".repeat(32),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("producer manual payment ledger contract", () => {
  it("writes the receipt as an already-confirmed proof and the money as a manual ledger row", () => {
    expect(moduleSource).toContain('status: "confirmed"');
    expect(moduleSource).toContain("confirmedAt: now");
    expect(moduleSource.match(/insert\(purchasePayments\)/g) ?? []).toHaveLength(0);
    expect(moduleSource).toContain('source: "manual"');
    expect(moduleSource).toContain("purchaseLedgerRepositoryForTransaction(tx, ledgerScope)");
    expect(moduleSource).toContain("await lockPurchaseLedgerScope(tx, ledgerScope)");
  });

  it("gates both the presign and the record step with the same eligibility check", () => {
    expect(moduleSource.match(/assertInstallmentAcceptsManualPayment\(\{/g)).toHaveLength(2);
    expect(moduleSource).toContain("token.viewerClerkUserId !== input.clerkUserId");
  });

  it("exposes producer-only procedures with uuid operation keys and private receipt types", () => {
    for (const name of ["presignManualReceipt", "cancelManualReceipt", "recordManualPayment"]) {
      expect(routerSource).toMatch(new RegExp(`${name}: producerProcedure`));
    }
    expect(
      routerSource.match(/operationKey: z\.string\(\)\.uuid\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(routerSource).toContain("contentType: z.enum(PROOF_CONTENT_TYPES)");
    expect(routerSource).toContain("sendProofVerifiedEmail(email.artistEmail, email)");
  });
});
