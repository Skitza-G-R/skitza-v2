import { randomUUID } from "node:crypto";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { purchaseRepositoryForTransaction, type PurchaseTransactionDb } from "../db";
import { snapshotCommercialTerms } from "../policy";
import { PurchaseDomainError } from "../service";

class QueuedQuery implements PromiseLike<unknown[]> {
  readonly #rows: unknown[];

  constructor(rows: unknown[]) {
    this.#rows = rows;
  }

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  for(): this {
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#rows).then(onfulfilled, onrejected);
  }
}

class QueuedTransactionDb {
  readonly #selectRows: unknown[][];
  selectCount = 0;

  constructor(selectRows: unknown[][]) {
    this.#selectRows = [...selectRows];
  }

  select(): QueuedQuery {
    const rows = this.#selectRows.shift();
    if (!rows) throw new Error("Unexpected select in operation-key collision test double");
    this.selectCount += 1;
    return new QueuedQuery(rows);
  }

  execute(): Promise<void> {
    return Promise.resolve();
  }

  asTransactionDb(): PurchaseTransactionDb {
    return this as unknown as PurchaseTransactionDb;
  }
}

function commercialSnapshot(): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: "Imported existing work",
    deliverables: ["One master"],
    lineItems: [
      {
        label: "Imported production",
        quantity: 1,
        listUnitPriceCents: 100_000,
        unitPriceCents: 100_000,
        totalCents: 100_000,
      },
    ],
    listSubtotalCents: 100_000,
    discountCents: 0,
    subtotalCents: 100_000,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents: 100_000,
    currency: "ILS",
    includedSongSpaces: 1,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    selectedPaymentPlan: { kind: "full" },
    offeredPaymentPlans: [{ kind: "full" }],
    agreementText: "Imported existing work brought in by the producer.",
  };
}

function importedPurchaseRow(scope: {
  producerId: string;
  clientContactId: string;
  operationKey: string;
}) {
  const snapshot = commercialSnapshot();
  const establishedAt = new Date("2026-07-20T09:30:00.000Z");
  return {
    id: randomUUID(),
    producerId: scope.producerId,
    projectId: randomUUID(),
    clientContactId: scope.clientContactId,
    sourceKind: "imported_existing_work" as const,
    productId: null,
    privateOfferId: null,
    purchaseRequestId: null,
    operationKey: scope.operationKey,
    operationDigest: "import-digest",
    commercialSnapshot: snapshot,
    snapshotDigest: snapshotCommercialTerms(snapshot).digest,
    totalCents: snapshot.totalCents,
    paymentPlanKind: "full" as const,
    // Imported existing work never carries an Artist acceptance time.
    acceptedAt: null,
    commercialEstablishedAt: establishedAt,
    lifecycleStatus: "active" as const,
    activatedAt: establishedAt,
    canceledAt: null,
  };
}

async function findByOperationKey(
  db: QueuedTransactionDb,
  scope: { producerId: string; clientContactId: string; operationKey: string },
) {
  return purchaseRepositoryForTransaction(db.asTransactionDb()).atomically(
    { kind: "purchase_operation", ...scope },
    (transaction) => transaction.findPurchaseByOperationKey(scope),
  );
}

describe("operation-key lookup against imported existing work", () => {
  const scope = {
    producerId: randomUUID(),
    clientContactId: randomUUID(),
    operationKey: randomUUID(),
  };

  it("raises a clean conflict instead of a raw 500 when an import owns the key", async () => {
    // The second queue entry is the installment read the old code reached
    // before it blew up on the import row. The fix must never get that far.
    const db = new QueuedTransactionDb([[importedPurchaseRow(scope)], []]);

    const rejection: unknown = await findByOperationKey(db, scope).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(PurchaseDomainError);
    expect((rejection as PurchaseDomainError).code).toBe("OPERATION_KEY_CONFLICT");
    expect((rejection as PurchaseDomainError).message).toContain("imported existing work");
  });

  it("still reports no match when nothing owns the key", async () => {
    const db = new QueuedTransactionDb([[]]);

    await expect(findByOperationKey(db, scope)).resolves.toBeNull();
    expect(db.selectCount).toBe(1);
  });
});
