import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Db, PurchaseCommercialSnapshot } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { loadAcceptedPurchaseForProducerRequest } from "../db";
import { snapshotCommercialTerms } from "../policy";

class QueuedQuery implements PromiseLike<unknown[]> {
  readonly #rows: unknown[];

  constructor(rows: unknown[]) {
    this.#rows = rows;
  }

  from(): this {
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

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#rows).then(onfulfilled, onrejected);
  }
}

class QueuedReadDb {
  readonly #selectRows: unknown[][];
  selectCount = 0;

  constructor(selectRows: unknown[][]) {
    this.#selectRows = [...selectRows];
  }

  select(): QueuedQuery {
    const rows = this.#selectRows.shift();
    if (!rows) throw new Error("Unexpected select in accepted-request test double");
    this.selectCount += 1;
    return new QueuedQuery(rows);
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function commercialSnapshot(
  agreementText = "Exact accepted agreement",
): PurchaseCommercialSnapshot {
  return {
    version: 1,
    productOrOfferName: "Original product name",
    deliverables: ["Three masters"],
    lineItems: [
      {
        label: "Production per song",
        quantity: 3,
        listUnitPriceCents: 100_000,
        unitPriceCents: 90_000,
        totalCents: 270_000,
      },
    ],
    listSubtotalCents: 300_000,
    discountCents: 30_000,
    subtotalCents: 270_000,
    tax: { mode: "tax_added", ratePct: 18, amountCents: 48_600 },
    totalCents: 318_600,
    currency: "ILS",
    includedSongSpaces: 3,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: null,
    rights: ["Artist owns the approved masters."],
    selectedPaymentPlan: { kind: "full" },
    offeredPaymentPlans: [{ kind: "full" }],
    agreementText,
  };
}

function fixture(input: { acceptedAgreement?: string } = {}) {
  const producerId = randomUUID();
  const clientContactId = randomUUID();
  const purchaseRequestId = randomUUID();
  const purchaseId = randomUUID();
  const acceptedAt = new Date("2026-07-20T09:30:00.000Z");
  const purchaseSnapshot = commercialSnapshot();
  const acceptedSnapshot = commercialSnapshot(
    input.acceptedAgreement ?? purchaseSnapshot.agreementText,
  );
  const purchaseFrozen = snapshotCommercialTerms(purchaseSnapshot);
  const acceptanceFrozen = snapshotCommercialTerms(acceptedSnapshot);

  return {
    scope: { producerId, clientContactId, purchaseRequestId },
    purchaseRow: {
      id: purchaseId,
      producerId,
      projectId: randomUUID(),
      clientContactId,
      sourceKind: "store_product" as const,
      productId: randomUUID(),
      privateOfferId: null,
      purchaseRequestId,
      operationKey: "accept-operation",
      operationDigest: "accept-digest",
      commercialSnapshot: purchaseSnapshot,
      snapshotDigest: purchaseFrozen.digest,
      totalCents: purchaseSnapshot.totalCents,
      paymentPlanKind: "full" as const,
      acceptedAt,
      lifecycleStatus: "waiting_for_payment" as const,
      activatedAt: null,
      canceledAt: null,
    },
    scheduleRow: {
      position: 1,
      amountCents: purchaseSnapshot.totalCents,
      dueTrigger: "acceptance" as const,
      status: "due" as const,
    },
    acceptanceRow: {
      id: randomUUID(),
      purchaseId,
      producerId,
      clientContactId,
      acceptedByClerkUserId: "artist_test",
      acceptedSnapshot,
      snapshotDigest: acceptanceFrozen.digest,
      acceptedAt,
    },
  };
}

describe("accepted Purchase read for a producer request", () => {
  it("returns validated frozen commercial and acceptance truth", async () => {
    const data = fixture();
    const db = new QueuedReadDb([[data.purchaseRow], [data.scheduleRow], [data.acceptanceRow]]);

    const result = await loadAcceptedPurchaseForProducerRequest(db.asDb(), data.scope);

    expect(result?.purchase.source.purchaseRequestId).toBe(data.scope.purchaseRequestId);
    expect(result?.purchase.commercialSnapshot.value).toMatchObject({
      productOrOfferName: "Original product name",
      includedSongSpaces: 3,
      selectedPaymentPlan: { kind: "full" },
      agreementText: "Exact accepted agreement",
    });
    expect(result?.acceptance.acceptedByClerkUserId).toBe("artist_test");
    expect(result?.purchase.schedule).toEqual([
      {
        sequence: 1,
        amountCents: 318_600,
        trigger: "acceptance",
        status: "due",
      },
    ]);
  });

  it("uses the same null result for missing and out-of-scope rows", async () => {
    const data = fixture();
    const missingDb = new QueuedReadDb([[]]);
    const foreignDb = new QueuedReadDb([[]]);

    await expect(
      loadAcceptedPurchaseForProducerRequest(missingDb.asDb(), data.scope),
    ).resolves.toBeNull();
    await expect(
      loadAcceptedPurchaseForProducerRequest(foreignDb.asDb(), {
        ...data.scope,
        producerId: randomUUID(),
      }),
    ).resolves.toBeNull();
    expect(missingDb.selectCount).toBe(1);
    expect(foreignDb.selectCount).toBe(1);
  });

  it("fails closed when Purchase and acceptance snapshots disagree", async () => {
    const data = fixture({ acceptedAgreement: "Tampered acceptance" });
    const db = new QueuedReadDb([[data.purchaseRow], [data.scheduleRow], [data.acceptanceRow]]);

    await expect(loadAcceptedPurchaseForProducerRequest(db.asDb(), data.scope)).rejects.toThrow(
      "Accepted request commercial history is inconsistent",
    );
  });

  it("puts producer, client, and request ownership in the database predicates", () => {
    const source = readFileSync(join(__dirname, "../db.ts"), "utf8");
    const helper = source.slice(
      source.indexOf("export async function loadAcceptedPurchaseForProducerRequest"),
      source.indexOf("function acceptanceRecord"),
    );

    expect(helper).toMatch(/eq\(purchases\.producerId, input\.producerId\)/);
    expect(helper).toMatch(/eq\(purchases\.clientContactId, input\.clientContactId\)/);
    expect(helper).toMatch(/eq\(purchases\.purchaseRequestId, input\.purchaseRequestId\)/);
    expect(helper).toMatch(/eq\(purchaseAcceptances\.producerId, input\.producerId\)/);
    expect(helper).toMatch(/eq\(purchaseAcceptances\.clientContactId, input\.clientContactId\)/);
  });
});
