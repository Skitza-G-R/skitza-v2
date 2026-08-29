import { describe, expect, it } from "vitest";

import { PurchaseLedgerDomainError } from "../policy";
import { proofPaymentOperationDigest } from "../operation-digest";
import {
  cancelPurchase,
  correctPurchasePayment,
  pauseProjectForOverdueInstallment,
  readPurchaseLedger,
  reconcilePurchaseLedger,
  recordConfirmedPurchasePayment,
  requestImportedFinalPayment,
  resumePaymentPausedProject,
  setInstallmentRemindersEnabled,
  waiveInstallmentDebt,
  type NewProjectPaymentPauseEvent,
  type NewPurchaseCancellation,
  type NewPurchaseCorrection,
  type NewPurchasePayment,
  type NewPurchaseWaiver,
  type PurchaseLedgerRepository,
  type PurchaseLedgerSnapshot,
  type PurchaseLedgerTransaction,
} from "../service";

const ACCEPTED_AT = new Date("2026-01-31T15:00:00.000Z");

function snapshot(
  plan: "full" | "split_50_50" | "monthly" = "full",
  count = plan === "monthly" ? 3 : plan === "split_50_50" ? 2 : 1,
): PurchaseLedgerSnapshot {
  const amounts = Array.from({ length: count }, (_, index) =>
    index === 0 ? Math.floor(10_000 / count) + (10_000 % count) : Math.floor(10_000 / count),
  );
  return {
    purchase: {
      id: "purchase-a",
      producerId: "producer-a",
      projectId: "project-a",
      clientContactId: "client-a",
      currency: "USD",
      totalCents: 10_000,
      plan,
      lifecycleStatus: "waiting_for_payment",
      sourceKind: "store_product",
      acceptedAt: ACCEPTED_AT,
      commercialEstablishedAt: ACCEPTED_AT,
      activatedAt: null,
      canceledAt: null,
    },
    project: {
      id: "project-a",
      producerId: "producer-a",
      clientContactId: "client-a",
      lifecycleStatus: "waiting_for_payment",
    },
    producer: {
      id: "producer-a",
      timeZone: "America/New_York",
      automaticRemindersEnabled: true,
      displayName: "Producer",
      slug: "producer-a",
    },
    client: { id: "client-a", name: "Artist", email: "artist@example.com", connected: true },
    purchaseName: "Mix",
    refNumber: "SK-TEST",
    installments: amounts.map((amountCents, index) => ({
      id: `installment-${String(index + 1)}`,
      purchaseId: "purchase-a",
      producerId: "producer-a",
      position: index + 1,
      amountCents,
      currency: "USD",
      dueTrigger:
        index === 0
          ? ("acceptance" as const)
          : plan === "monthly"
            ? ("monthly_anniversary" as const)
            : ("artist_approval" as const),
      dueAt: index === 0 ? ACCEPTED_AT : null,
      triggeredAt: index === 0 ? ACCEPTED_AT : null,
      requiredForActivation: index === 0,
      status: "not_paid" as const,
      remindersEnabled: true,
    })),
    payments: [],
    corrections: [],
    waivers: [],
    pendingProofInstallmentIds: [],
    cancellation: null,
    pauseEvents: [],
  };
}

class MemoryLedgerRepository implements PurchaseLedgerRepository {
  current: PurchaseLedgerSnapshot;
  private id = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(value: PurchaseLedgerSnapshot) {
    this.current = value;
  }

  async atomically<T>(
    _scope: Readonly<{ producerId: string; purchaseId: string }>,
    work: (transaction: PurchaseLedgerTransaction) => Promise<T>,
  ): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work(this.transaction());
    } finally {
      release();
    }
  }

  private nextId(prefix: string) {
    this.id += 1;
    return `${prefix}-${String(this.id)}`;
  }

  private transaction(): PurchaseLedgerTransaction {
    return {
      loadSnapshot: () => Promise.resolve(this.current),
      insertPayment: (input: NewPurchasePayment) => {
        const row = { ...input, id: this.nextId("payment") };
        this.current = { ...this.current, payments: [...this.current.payments, row] };
        return Promise.resolve(row);
      },
      insertCorrection: (input: NewPurchaseCorrection) => {
        const row = { ...input, id: this.nextId("correction") };
        this.current = { ...this.current, corrections: [...this.current.corrections, row] };
        return Promise.resolve(row);
      },
      insertWaiver: (input: NewPurchaseWaiver) => {
        const row = { ...input, id: this.nextId("waiver") };
        this.current = { ...this.current, waivers: [...this.current.waivers, row] };
        return Promise.resolve(row);
      },
      insertCancellation: (input: NewPurchaseCancellation) => {
        const row = { ...input, id: this.nextId("cancellation") };
        this.current = { ...this.current, cancellation: row };
        return Promise.resolve(row);
      },
      setMonthlyInstallmentDates: (rows, changedAt) => {
        const byId = new Map(rows.map((row) => [row.installmentId, row]));
        let changed = 0;
        this.current = {
          ...this.current,
          installments: this.current.installments.map((installment) => {
            const row = byId.get(installment.id);
            if (!row || installment.dueAt !== null || installment.triggeredAt !== null) {
              return installment;
            }
            changed += 1;
            return { ...installment, dueAt: row.dueAt, triggeredAt: row.triggeredAt };
          }),
        };
        void changedAt;
        return Promise.resolve(changed);
      },
      triggerImportedFinalInstallment: (installmentId, triggeredAt) => {
        let changed = false;
        this.current = {
          ...this.current,
          installments: this.current.installments.map((installment) => {
            if (
              installment.id !== installmentId ||
              installment.dueTrigger !== "artist_approval" ||
              installment.status !== "not_paid" ||
              installment.dueAt !== null ||
              installment.triggeredAt !== null
            ) {
              return installment;
            }
            changed = true;
            return { ...installment, dueAt: triggeredAt, triggeredAt };
          }),
        };
        return Promise.resolve(changed);
      },
      setInstallmentStatuses: (rows) => {
        const byId = new Map(rows.map((row) => [row.installmentId, row.status]));
        let changed = 0;
        this.current = {
          ...this.current,
          installments: this.current.installments.map((installment) => {
            const status = byId.get(installment.id);
            if (!status) return installment;
            changed += 1;
            return { ...installment, status };
          }),
        };
        return Promise.resolve(changed);
      },
      activatePurchaseAndWaitingProject: (activatedAt) => {
        this.current = {
          ...this.current,
          purchase: {
            ...this.current.purchase,
            lifecycleStatus: "active",
            activatedAt,
          },
          project:
            this.current.project.lifecycleStatus === "waiting_for_payment"
              ? { ...this.current.project, lifecycleStatus: "active" }
              : this.current.project,
        };
        return Promise.resolve();
      },
      setInstallmentRemindersEnabled: (installmentId, enabled) => {
        let changed = false;
        this.current = {
          ...this.current,
          installments: this.current.installments.map((installment) => {
            if (installment.id !== installmentId) return installment;
            changed = true;
            return { ...installment, remindersEnabled: enabled };
          }),
        };
        return Promise.resolve(changed);
      },
      cancelFutureInstallments: (installmentIds) => {
        const ids = new Set(installmentIds);
        let changed = 0;
        this.current = {
          ...this.current,
          installments: this.current.installments.map((installment) => {
            if (!ids.has(installment.id)) return installment;
            changed += 1;
            return { ...installment, status: "canceled", remindersEnabled: false };
          }),
        };
        return Promise.resolve(changed);
      },
      cancelPurchase: (canceledAt) => {
        if (this.current.purchase.lifecycleStatus === "canceled") return Promise.resolve(false);
        this.current = {
          ...this.current,
          purchase: {
            ...this.current.purchase,
            lifecycleStatus: "canceled",
            canceledAt,
          },
        };
        return Promise.resolve(true);
      },
      transitionProject: (from, to) => {
        if (this.current.project.lifecycleStatus !== from) return Promise.resolve(false);
        this.current = {
          ...this.current,
          project: { ...this.current.project, lifecycleStatus: to },
        };
        return Promise.resolve(true);
      },
      insertPauseEvent: (input: NewProjectPaymentPauseEvent) => {
        const row = { ...input, id: this.nextId("pause") };
        this.current = { ...this.current, pauseEvents: [...this.current.pauseEvents, row] };
        return Promise.resolve(row);
      },
    };
  }
}

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    producerId: "producer-a",
    purchaseId: "purchase-a",
    installmentId: "installment-1",
    operationKey: "manual-1",
    source: "manual" as const,
    amountCents: 10_000,
    currency: "USD",
    paidAt: ACCEPTED_AT,
    occurredAt: ACCEPTED_AT,
    actorId: "clerk-producer",
    note: null,
    ...overrides,
  };
}

describe("purchase ledger transitions", () => {
  it("accepts either real Artist acceptance or imported producer establishment, never a hybrid", async () => {
    const accepted = new MemoryLedgerRepository(snapshot());
    await expect(
      readPurchaseLedger(accepted, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        asOf: ACCEPTED_AT,
      }),
    ).resolves.toMatchObject({ snapshot: { purchase: { sourceKind: "store_product" } } });

    const importedSnapshot: PurchaseLedgerSnapshot = {
      ...snapshot(),
      purchase: {
        ...snapshot().purchase,
        sourceKind: "imported_existing_work",
        acceptedAt: null,
      },
      installments: snapshot().installments.map((installment, index) =>
        index === 0 ? { ...installment, dueTrigger: "producer_import" as const } : installment,
      ),
    };
    await expect(
      readPurchaseLedger(new MemoryLedgerRepository(importedSnapshot), {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        asOf: ACCEPTED_AT,
      }),
    ).resolves.toMatchObject({
      snapshot: {
        purchase: { sourceKind: "imported_existing_work", acceptedAt: null },
      },
    });

    for (const invalidPurchase of [
      { ...snapshot().purchase, acceptedAt: null },
      {
        ...snapshot().purchase,
        commercialEstablishedAt: new Date(ACCEPTED_AT.getTime() + 1),
      },
      {
        ...importedSnapshot.purchase,
        acceptedAt: ACCEPTED_AT,
      },
      {
        ...importedSnapshot.purchase,
        commercialEstablishedAt: new Date(Number.NaN),
      },
    ]) {
      const repository = new MemoryLedgerRepository({
        ...importedSnapshot,
        purchase: invalidPurchase,
      });
      await expect(
        readPurchaseLedger(repository, {
          producerId: "producer-a",
          purchaseId: "purchase-a",
          asOf: ACCEPTED_AT,
        }),
      ).rejects.toMatchObject({
        code: "INTEGRITY_ERROR",
        message: "Purchase commercial establishment history is invalid",
      });
    }
  });

  it("enables an unpaid final 50% preference but rejects settled debt", async () => {
    const value = snapshot("split_50_50");
    const imported: PurchaseLedgerSnapshot = {
      ...value,
      purchase: {
        ...value.purchase,
        sourceKind: "imported_existing_work",
        acceptedAt: null,
      },
      installments: value.installments.map((installment, index) => ({
        ...installment,
        dueTrigger: index === 0 ? "producer_import" : "artist_approval",
        remindersEnabled: false,
      })),
    };
    const repository = new MemoryLedgerRepository(imported);
    await expect(
      setInstallmentRemindersEnabled(repository, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        installmentId: "installment-2",
        enabled: true,
      }),
    ).resolves.toEqual({ enabled: true, changed: true });
    expect(repository.current.installments[1]).toMatchObject({
      dueTrigger: "artist_approval",
      dueAt: null,
      remindersEnabled: true,
    });

    const settled = new MemoryLedgerRepository({
      ...imported,
      installments: imported.installments.map((installment, index) => ({
        ...installment,
        remindersEnabled: false,
        status: index === 0 ? "confirmed" : installment.status,
      })),
      payments: [
        {
          id: "settled-payment",
          purchaseId: "purchase-a",
          installmentId: "installment-1",
          producerId: "producer-a",
          operationKey: "settled-payment",
          operationDigest: "settled-digest",
          source: "manual",
          proofId: null,
          amountCents: 5_000,
          currency: "USD",
          paidAt: ACCEPTED_AT,
          addedByClerkUserId: "clerk-producer",
          note: null,
        },
      ],
    });
    await expect(
      setInstallmentRemindersEnabled(settled, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        installmentId: "installment-1",
        enabled: true,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Reminders can be enabled only for an unpaid installment",
    });
  });

  it("requires the complete first installment before activation", async () => {
    const repository = new MemoryLedgerRepository(snapshot());
    const partial = await recordConfirmedPurchasePayment(
      repository,
      manualInput({ operationKey: "partial", amountCents: 4_000 }),
    );
    expect(partial.projection.activationSatisfied).toBe(false);
    expect(repository.current.project.lifecycleStatus).toBe("waiting_for_payment");

    const completed = await recordConfirmedPurchasePayment(
      repository,
      manualInput({ operationKey: "remainder", amountCents: 6_000 }),
    );
    expect(completed.projection.activationSatisfied).toBe(true);
    expect(repository.current.purchase.lifecycleStatus).toBe("active");
    expect(repository.current.project.lifecycleStatus).toBe("active");
  });

  it("activates one waiting purchase without disturbing an already-active sibling project", async () => {
    const value = snapshot();
    const repository = new MemoryLedgerRepository({
      ...value,
      project: { ...value.project, lifecycleStatus: "active" },
    });

    const result = await recordConfirmedPurchasePayment(repository, manualInput());

    expect(result.projection.activationSatisfied).toBe(true);
    expect(repository.current.purchase.lifecycleStatus).toBe("active");
    expect(repository.current.project.lifecycleStatus).toBe("active");
  });

  it("keeps sibling purchases in one project separated by schedule, currency, and history", async () => {
    const usdRepository = new MemoryLedgerRepository(snapshot("split_50_50"));
    const eurBase = snapshot("monthly");
    const eurRepository = new MemoryLedgerRepository({
      ...eurBase,
      purchase: {
        ...eurBase.purchase,
        id: "purchase-b",
        currency: "EUR",
      },
      installments: eurBase.installments.map((installment) => ({
        ...installment,
        id: installment.id.replace("installment", "eur-installment"),
        purchaseId: "purchase-b",
        currency: "EUR",
      })),
    });

    const [usd, eur] = await Promise.all([
      recordConfirmedPurchasePayment(
        usdRepository,
        manualInput({ operationKey: "usd-first", amountCents: 5_000 }),
      ),
      recordConfirmedPurchasePayment(
        eurRepository,
        manualInput({
          purchaseId: "purchase-b",
          installmentId: "eur-installment-1",
          operationKey: "eur-first",
          amountCents: 3_334,
          currency: "EUR",
        }),
      ),
    ]);

    expect(usd.projection).toMatchObject({ currency: "USD", remainingCents: 5_000 });
    expect(eur.projection).toMatchObject({ currency: "EUR", remainingCents: 6_666 });
    expect(usdRepository.current.installments).toHaveLength(2);
    expect(eurRepository.current.installments).toHaveLength(3);
    expect(usdRepository.current.payments.map((payment) => payment.operationKey)).toEqual([
      "usd-first",
    ]);
    expect(eurRepository.current.payments.map((payment) => payment.operationKey)).toEqual([
      "eur-first",
    ]);
  });

  it("anchors Monthly dates to the first partial confirmation and never shifts them", async () => {
    const repository = new MemoryLedgerRepository(snapshot("monthly"));
    await recordConfirmedPurchasePayment(
      repository,
      manualInput({ operationKey: "partial", amountCents: 1_000 }),
    );
    expect(repository.current.installments.slice(1).map((row) => row.dueAt?.toISOString())).toEqual(
      ["2026-02-28T15:00:00.000Z", "2026-03-31T14:00:00.000Z"],
    );
    await recordConfirmedPurchasePayment(
      repository,
      manualInput({
        operationKey: "remainder",
        amountCents: 2_334,
        paidAt: new Date("2026-02-02T15:00:00.000Z"),
      }),
    );
    expect(repository.current.installments.slice(1).map((row) => row.dueAt?.toISOString())).toEqual(
      ["2026-02-28T15:00:00.000Z", "2026-03-31T14:00:00.000Z"],
    );
  });

  // SK-270: imported work carries the real first due date the producer typed
  // in the wizard. Months must count forward from it, with no payment at all —
  // an imported Monthly plan used to leave installments 2..N without any date.
  it("anchors an imported Monthly plan on its own first due date without any payment", async () => {
    const base = snapshot("monthly");
    const firstDueAt = new Date("2026-03-10T00:00:00.000Z");
    const repository = new MemoryLedgerRepository({
      ...base,
      purchase: {
        ...base.purchase,
        sourceKind: "imported_existing_work",
        acceptedAt: null,
      },
      installments: base.installments.map((installment, index) =>
        index === 0
          ? {
              ...installment,
              dueTrigger: "producer_import" as const,
              dueAt: firstDueAt,
              triggeredAt: ACCEPTED_AT,
            }
          : installment,
      ),
    });

    await reconcilePurchaseLedger(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      asOf: ACCEPTED_AT,
    });

    expect(repository.current.payments).toHaveLength(0);
    expect(repository.current.installments.map((row) => row.dueAt?.toISOString())).toEqual([
      "2026-03-10T00:00:00.000Z",
      "2026-04-10T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
    ]);
    expect(
      repository.current.installments.slice(1).map((row) => row.triggeredAt?.toISOString()),
    ).toEqual(["2026-03-10T00:00:00.000Z", "2026-03-10T00:00:00.000Z"]);
  });

  // SK-270 regression: recording real payment history is the whole point of
  // the import wizard, so an import that has history and skipped the optional
  // "when is the first payment due?" question must keep anchoring on the first
  // recorded payment. Anchoring it on the import day instead would silently
  // re-date months of history forward.
  it("keeps anchoring an imported Monthly plan with payment history on its first payment", async () => {
    const base = snapshot("monthly");
    const firstPaidAt = new Date("2026-05-01T16:00:00.000Z");
    const repository = new MemoryLedgerRepository({
      ...base,
      purchase: {
        ...base.purchase,
        sourceKind: "imported_existing_work",
        acceptedAt: null,
      },
      installments: base.installments.map((installment, index) =>
        index === 0
          ? {
              ...installment,
              dueTrigger: "producer_import" as const,
              // No date was captured, so the writer stored the import instant
              // itself — exactly `commercialEstablishedAt`.
              dueAt: base.purchase.commercialEstablishedAt,
              triggeredAt: base.purchase.commercialEstablishedAt,
              status: "confirmed" as const,
            }
          : installment,
      ),
      payments: [
        {
          id: "payment-history-1",
          purchaseId: "purchase-a",
          installmentId: "installment-1",
          producerId: "producer-a",
          amountCents: base.installments[0]?.amountCents ?? 0,
          currency: "USD",
          operationKey: "import-payment-1",
          operationDigest: "digest-import-payment-1",
          source: "manual" as const,
          proofId: null,
          paidAt: firstPaidAt,
          addedByClerkUserId: "clerk-producer",
          note: null,
        },
      ],
    });

    await reconcilePurchaseLedger(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      asOf: new Date("2026-05-02T16:00:00.000Z"),
    });

    // Months still count from the recorded payment, not from the import day
    // (2026-01-31), which would have produced February and March dates.
    expect(repository.current.installments.slice(1).map((row) => row.dueAt?.toISOString())).toEqual(
      ["2026-06-01T16:00:00.000Z", "2026-07-01T16:00:00.000Z"],
    );
    expect(
      repository.current.installments.slice(1).map((row) => row.triggeredAt?.toISOString()),
    ).toEqual([firstPaidAt.toISOString(), firstPaidAt.toISOString()]);
  });

  it("does not accept the 50/50 final half before exact-version approval triggers it", async () => {
    const repository = new MemoryLedgerRepository(snapshot("split_50_50"));
    await expect(
      recordConfirmedPurchasePayment(
        repository,
        manualInput({ installmentId: "installment-2", amountCents: 5_000 }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not waive the 50/50 final half before exact-version approval triggers it", async () => {
    const repository = new MemoryLedgerRepository(snapshot("split_50_50"));
    const waiver = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-2",
      operationKey: "premature-final-waiver",
      amountCents: 5_000,
      reason: "Do not collect the final half",
      actorId: "clerk-producer",
      waivedAt: ACCEPTED_AT,
    };

    await expect(waiveInstallmentDebt(repository, waiver)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(repository.current.waivers).toHaveLength(0);

    repository.current = {
      ...repository.current,
      installments: repository.current.installments.map((installment) =>
        installment.id === "installment-2"
          ? { ...installment, dueAt: ACCEPTED_AT, triggeredAt: ACCEPTED_AT }
          : installment,
      ),
    };
    await expect(waiveInstallmentDebt(repository, waiver)).resolves.toMatchObject({
      created: true,
    });
  });

  it("is intent-idempotent under concurrent retries and rejects changed intent", async () => {
    const repository = new MemoryLedgerRepository(snapshot());
    const results = await Promise.all([
      recordConfirmedPurchasePayment(repository, manualInput()),
      recordConfirmedPurchasePayment(repository, manualInput()),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(repository.current.payments).toHaveLength(1);
    await expect(
      recordConfirmedPurchasePayment(repository, manualInput({ amountCents: 9_999 })),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("replays immutable payments after a later waiver or cancellation", async () => {
    const waivedRepository = new MemoryLedgerRepository(snapshot());
    const partialInput = manualInput({
      operationKey: "payment-before-waiver",
      amountCents: 4_000,
    });
    const original = await recordConfirmedPurchasePayment(waivedRepository, partialInput);
    await waiveInstallmentDebt(waivedRepository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-1",
      operationKey: "waive-after-payment",
      amountCents: 6_000,
      reason: "Waive the remaining balance",
      actorId: "clerk-producer",
      waivedAt: new Date("2026-02-01T15:00:00.000Z"),
    });

    await expect(
      recordConfirmedPurchasePayment(waivedRepository, partialInput),
    ).resolves.toMatchObject({ created: false, record: { id: original.record.id } });
    await expect(
      recordConfirmedPurchasePayment(waivedRepository, {
        ...partialInput,
        amountCents: 4_001,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });

    const canceledRepository = new MemoryLedgerRepository(snapshot());
    const canceledInput = manualInput({
      operationKey: "payment-before-cancellation",
      amountCents: 2_000,
    });
    const canceledPayment = await recordConfirmedPurchasePayment(canceledRepository, canceledInput);
    canceledRepository.current = {
      ...canceledRepository.current,
      purchase: {
        ...canceledRepository.current.purchase,
        lifecycleStatus: "canceled",
        canceledAt: new Date("2026-02-02T15:00:00.000Z"),
      },
      installments: canceledRepository.current.installments.map((installment) => ({
        ...installment,
        status: "canceled",
      })),
    };

    await expect(
      recordConfirmedPurchasePayment(canceledRepository, canceledInput),
    ).resolves.toMatchObject({
      created: false,
      record: { id: canceledPayment.record.id },
    });
  });

  it("replays Chat 14 proof payments with their original immutable digest", async () => {
    const value = snapshot();
    const proofId = "proof-from-chat-14";
    const operationKey = `proof:${proofId}`;
    const repository = new MemoryLedgerRepository({
      ...value,
      installments: value.installments.map((installment) => ({
        ...installment,
        status: "confirmed",
      })),
      payments: [
        {
          id: "legacy-proof-payment",
          purchaseId: "purchase-a",
          installmentId: "installment-1",
          producerId: "producer-a",
          operationKey,
          operationDigest: proofPaymentOperationDigest({
            proofId,
            purchaseId: "purchase-a",
            installmentId: "installment-1",
            amountCents: 10_000,
            currency: "USD",
          }),
          source: "proof",
          proofId,
          amountCents: 10_000,
          currency: "USD",
          paidAt: ACCEPTED_AT,
          addedByClerkUserId: "original-producer-user",
          note: "Original proof note",
        },
      ],
    });

    const replay = await recordConfirmedPurchasePayment(repository, {
      ...manualInput({
        operationKey,
        source: "proof",
        proofId,
        actorId: "replacement-producer-user",
        paidAt: new Date("2026-02-01T15:00:00.000Z"),
        note: "Current proof note does not rewrite history",
      }),
    });

    expect(replay.created).toBe(false);
    expect(repository.current.payments).toHaveLength(1);
    expect(replay.record.addedByClerkUserId).toBe("original-producer-user");
  });

  it("replays audited corrections and waivers once and rejects changed intent", async () => {
    const correctionRepository = new MemoryLedgerRepository(snapshot());
    const payment = await recordConfirmedPurchasePayment(correctionRepository, manualInput());
    const correctionInput = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      paymentId: payment.record.id,
      operationKey: "correction-retry",
      newAmountCents: 4_000,
      reason: "Correct the bank amount",
      actorId: "clerk-producer",
      correctedAt: new Date("2026-02-01T15:00:00.000Z"),
    };
    const corrections = await Promise.all([
      correctPurchasePayment(correctionRepository, correctionInput),
      correctPurchasePayment(correctionRepository, {
        ...correctionInput,
        correctedAt: new Date("2026-02-01T16:00:00.000Z"),
      }),
    ]);
    expect(corrections.filter((result) => result.created)).toHaveLength(1);
    expect(correctionRepository.current.corrections).toHaveLength(1);
    await expect(
      correctPurchasePayment(correctionRepository, {
        ...correctionInput,
        newAmountCents: 5_000,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });

    const waiverRepository = new MemoryLedgerRepository(snapshot());
    const waiverInput = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-1",
      operationKey: "waiver-retry",
      amountCents: 10_000,
      reason: "Waive this balance",
      actorId: "clerk-producer",
      waivedAt: ACCEPTED_AT,
    };
    const waivers = await Promise.all([
      waiveInstallmentDebt(waiverRepository, waiverInput),
      waiveInstallmentDebt(waiverRepository, {
        ...waiverInput,
        waivedAt: new Date("2026-02-01T15:00:00.000Z"),
      }),
    ]);
    expect(waivers.filter((result) => result.created)).toHaveLength(1);
    expect(waiverRepository.current.waivers).toHaveLength(1);
    await expect(
      waiveInstallmentDebt(waiverRepository, { ...waiverInput, amountCents: 9_999 }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
  });

  it("keeps activation after a downward correction but relocks paid downloads", async () => {
    const repository = new MemoryLedgerRepository(snapshot());
    const paid = await recordConfirmedPurchasePayment(repository, manualInput());
    const corrected = await correctPurchasePayment(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      paymentId: paid.record.id,
      operationKey: "correction-1",
      newAmountCents: 4_000,
      reason: "Bank amount was entered incorrectly",
      actorId: "clerk-producer",
      correctedAt: new Date("2026-02-01T15:00:00.000Z"),
    });
    expect(repository.current.purchase.lifecycleStatus).toBe("active");
    expect(corrected.projection.activationRemainsSatisfied).toBe(true);
    expect(corrected.projection.fullyPaidForDownloads).toBe(false);
  });

  it("lets a waiver settle debt without activating or unlocking downloads", async () => {
    const repository = new MemoryLedgerRepository(snapshot());
    const result = await waiveInstallmentDebt(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-1",
      operationKey: "waiver-1",
      amountCents: 10_000,
      reason: "Producer waived the fee",
      actorId: "clerk-producer",
      waivedAt: ACCEPTED_AT,
    });
    expect(result.projection.settled).toBe(true);
    expect(result.projection.activationSatisfied).toBe(false);
    expect(result.projection.fullyPaidForDownloads).toBe(false);
    expect(repository.current.project.lifecycleStatus).toBe("waiting_for_payment");
  });

  it("cancels only future installments and retains already-due debt", async () => {
    const value = snapshot("monthly");
    const dueDates = [
      new Date("2026-01-31T15:00:00.000Z"),
      new Date("2026-02-01T15:00:00.000Z"),
      new Date("2026-03-31T14:00:00.000Z"),
    ];
    const repository = new MemoryLedgerRepository({
      ...value,
      installments: value.installments.map((installment, index) => {
        const dueAt = dueDates[index];
        if (!dueAt) throw new Error("Missing test installment due date");
        return { ...installment, dueAt, triggeredAt: ACCEPTED_AT };
      }),
    });
    const cancellationInput = {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      operationKey: "cancel-1",
      reason: "Work was canceled",
      actorId: "clerk-producer",
      canceledAt: new Date("2026-02-15T15:00:00.000Z"),
    };
    const results = await Promise.all([
      cancelPurchase(repository, cancellationInput),
      cancelPurchase(repository, cancellationInput),
    ]);
    const result = results[0];
    expect(results.filter((candidate) => candidate.created)).toHaveLength(1);
    expect(results.find((candidate) => candidate.created)?.canceledInstallmentIds).toEqual([
      "installment-3",
    ]);
    expect(results.find((candidate) => !candidate.created)?.canceledInstallmentIds).toEqual([]);
    expect(repository.current.cancellation).not.toBeNull();
    expect(result.projection.installments.map((row) => row.status)).toEqual([
      "overdue",
      "overdue",
      "canceled",
    ]);
    expect(result.projection.remainingCents).toBe(6_667);
  });

  it("preserves fully paid or waived future installment history on cancellation", async () => {
    const value = snapshot("monthly");
    const futureAt = new Date("2026-03-31T14:00:00.000Z");
    const repository = new MemoryLedgerRepository({
      ...value,
      installments: value.installments.map((installment, index) => ({
        ...installment,
        dueAt: index === 0 ? ACCEPTED_AT : futureAt,
        triggeredAt: ACCEPTED_AT,
        status: index === 1 ? "confirmed" : index === 2 ? "waived" : installment.status,
      })),
      payments: [
        {
          id: "future-payment",
          purchaseId: "purchase-a",
          installmentId: "installment-2",
          producerId: "producer-a",
          operationKey: "future-payment",
          operationDigest: "future-payment-digest",
          source: "manual",
          proofId: null,
          amountCents: 3_333,
          currency: "USD",
          paidAt: ACCEPTED_AT,
          addedByClerkUserId: "clerk-producer",
          note: null,
        },
      ],
      waivers: [
        {
          id: "future-waiver",
          purchaseId: "purchase-a",
          installmentId: "installment-3",
          producerId: "producer-a",
          operationKey: "future-waiver",
          operationDigest: "future-waiver-digest",
          amountCents: 3_333,
          reason: "Waived before cancellation",
          waivedByClerkUserId: "clerk-producer",
          createdAt: ACCEPTED_AT,
        },
      ],
    });

    const result = await cancelPurchase(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      operationKey: "cancel-settled-future",
      reason: "Cancel remaining work",
      actorId: "clerk-producer",
      canceledAt: new Date("2026-02-15T15:00:00.000Z"),
    });

    expect(result.projection.installments.map((row) => row.status)).toEqual([
      "overdue",
      "confirmed",
      "waived",
    ]);
    expect(result.canceledInstallmentIds).toEqual([]);
  });

  it("audits manual pause for overdue debt and an explicit resume", async () => {
    const value = snapshot();
    const repository = new MemoryLedgerRepository({
      ...value,
      purchase: { ...value.purchase, lifecycleStatus: "active", activatedAt: ACCEPTED_AT },
      project: { ...value.project, lifecycleStatus: "active" },
      installments: value.installments.map((row) => ({
        ...row,
        dueAt: new Date("2026-01-01T15:00:00.000Z"),
      })),
    });
    const paused = await pauseProjectForOverdueInstallment(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      operationKey: "pause-1",
      reason: "Payment is overdue",
      actorId: "clerk-producer",
      changedAt: new Date("2026-01-03T15:00:00.000Z"),
    });
    expect(paused.changed).toBe(true);
    expect(repository.current.project.lifecycleStatus).toBe("paused");
    const resumed = await resumePaymentPausedProject(repository, {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      operationKey: "resume-1",
      reason: "Producer resumed work",
      actorId: "clerk-producer",
      changedAt: new Date("2026-01-04T15:00:00.000Z"),
    });
    expect(resumed.changed).toBe(true);
    expect(repository.current.project.lifecycleStatus).toBe("active");
    expect(repository.current.pauseEvents.map((event) => event.action)).toEqual([
      "paused",
      "resumed",
    ]);
    expect(repository.current.pauseEvents.map((event) => event.purchaseId)).toEqual([
      "purchase-a",
      "purchase-a",
    ]);
  });

  it("hides a foreign tenant and rejects a foreign currency", async () => {
    const repository = new MemoryLedgerRepository(snapshot());
    await expect(
      recordConfirmedPurchasePayment(repository, manualInput({ producerId: "producer-b" })),
    ).rejects.toBeInstanceOf(PurchaseLedgerDomainError);
    await expect(
      recordConfirmedPurchasePayment(repository, manualInput({ currency: "EUR" })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects pause history from a sibling purchase in the same project", async () => {
    const value = snapshot();
    const repository = new MemoryLedgerRepository({
      ...value,
      pauseEvents: [
        {
          id: "sibling-pause",
          purchaseId: "purchase-b",
          projectId: value.project.id,
          producerId: value.purchase.producerId,
          action: "paused",
          operationKey: "pause-purchase-b",
          operationDigest: "sibling-digest",
          reason: "Purchase B is overdue",
          changedByClerkUserId: "clerk-producer",
          changedAt: new Date("2026-02-02T15:00:00.000Z"),
        },
      ],
    });

    await expect(
      reconcilePurchaseLedger(repository, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        asOf: new Date("2026-02-03T15:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  });

  it.each(["completed", "canceled"] as const)(
    "retains visible debt when the project is %s",
    async (lifecycleStatus) => {
      const value = snapshot();
      const repository = new MemoryLedgerRepository({
        ...value,
        purchase: { ...value.purchase, lifecycleStatus: "active", activatedAt: ACCEPTED_AT },
        project: { ...value.project, lifecycleStatus },
      });

      const result = await reconcilePurchaseLedger(repository, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        asOf: new Date("2026-02-02T15:00:00.000Z"),
      });

      expect(result.projection.remainingCents).toBe(10_000);
      expect(result.projection.installments[0]?.status).toBe("overdue");
      expect(repository.current.project.lifecycleStatus).toBe(lifecycleStatus);
    },
  );
});

// SK-269: on a 50/50 plan the second half waits for the artist to approve the
// final version inside Skitza. A client the producer imported by hand may never
// join, so that approval can never happen and the outstanding half is stuck:
// never due, never recordable, never even waivable. The producer — the only
// person who can say the imported work is finished — gets to say it.
describe("imported work asks for its own final payment", () => {
  const REQUESTED_AT = new Date("2026-08-29T09:00:00.000Z");

  function importedSplit(): PurchaseLedgerSnapshot {
    const value = snapshot("split_50_50");
    return {
      ...value,
      purchase: {
        ...value.purchase,
        sourceKind: "imported_existing_work",
        acceptedAt: null,
        lifecycleStatus: "active",
        activatedAt: ACCEPTED_AT,
      },
      installments: value.installments.map((installment, index) =>
        index === 0 ? { ...installment, dueTrigger: "producer_import" as const } : installment,
      ),
    };
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      producerId: "producer-a",
      purchaseId: "purchase-a",
      installmentId: "installment-2",
      requestedAt: REQUESTED_AT,
      ...overrides,
    };
  }

  it("makes the stuck half due, recordable, and waivable", async () => {
    const repository = new MemoryLedgerRepository(importedSplit());

    const result = await requestImportedFinalPayment(repository, request());

    expect(result).toMatchObject({ installmentId: "installment-2", changed: true });
    expect(result.dueAt.toISOString()).toBe(REQUESTED_AT.toISOString());
    const final = repository.current.installments[1];
    expect(final?.dueAt?.toISOString()).toBe(REQUESTED_AT.toISOString());
    expect(final?.triggeredAt?.toISOString()).toBe(REQUESTED_AT.toISOString());

    await expect(
      waiveInstallmentDebt(repository, {
        producerId: "producer-a",
        purchaseId: "purchase-a",
        installmentId: "installment-2",
        operationKey: "sk269-waive",
        amountCents: 5_000,
        reason: "This client will never pay the rest",
        actorId: "clerk-producer",
        waivedAt: REQUESTED_AT,
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it("lets the producer record the money once the work is done", async () => {
    const repository = new MemoryLedgerRepository(importedSplit());
    const payment = manualInput({
      installmentId: "installment-2",
      operationKey: "sk269-final-half",
      amountCents: 5_000,
      paidAt: REQUESTED_AT,
      occurredAt: REQUESTED_AT,
    });

    await expect(recordConfirmedPurchasePayment(repository, payment)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await requestImportedFinalPayment(repository, request());

    await expect(recordConfirmedPurchasePayment(repository, payment)).resolves.toMatchObject({
      created: true,
    });
  });

  it("is impossible on a purchase the artist can still approve in Skitza", async () => {
    const repository = new MemoryLedgerRepository(snapshot("split_50_50"));

    await expect(requestImportedFinalPayment(repository, request())).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Only imported work can be marked finished here.",
    });
    expect(repository.current.installments[1]?.dueAt).toBeNull();
    expect(repository.current.installments[1]?.triggeredAt).toBeNull();
  });

  it("never triggers twice, however many times it is pressed", async () => {
    const repository = new MemoryLedgerRepository(importedSplit());

    const first = await requestImportedFinalPayment(repository, request());
    const second = await requestImportedFinalPayment(
      repository,
      request({ requestedAt: new Date("2026-09-05T09:00:00.000Z") }),
    );

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.dueAt.toISOString()).toBe(REQUESTED_AT.toISOString());
    expect(repository.current.installments[1]?.dueAt?.toISOString()).toBe(
      REQUESTED_AT.toISOString(),
    );
  });

  it("stays invisible to another producer", async () => {
    const repository = new MemoryLedgerRepository(importedSplit());

    await expect(
      requestImportedFinalPayment(repository, request({ producerId: "producer-b" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repository.current.installments[1]?.dueAt).toBeNull();
    expect(repository.current.installments[1]?.triggeredAt).toBeNull();
  });

  it("refuses an installment that belongs to another purchase", async () => {
    const repository = new MemoryLedgerRepository(importedSplit());

    await expect(
      requestImportedFinalPayment(repository, request({ installmentId: "installment-9" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
