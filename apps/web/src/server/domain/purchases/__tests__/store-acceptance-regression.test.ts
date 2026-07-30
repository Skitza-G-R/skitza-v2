import type { Db, PaymentPlan } from "@skitza/db";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  acceptStorePurchase,
  previewStorePurchaseAcceptance,
  StoreAcceptanceError,
} from "../store-acceptance";

type AcceptanceContextFixture = {
  request: {
    id: string;
    producerId: string;
    clientContactId: string;
    productId: string;
    projectId: string | null;
    status: "pending" | "approved" | "declined" | "canceled" | "converted";
    requestedSongQty: number | null;
    artistName: string;
    artistEmail: string;
  };
  product: {
    id: string;
    producerId: string;
    name: string;
    description: string | null;
    kind: string;
    pricingModel: string;
    priceCents: number;
    currency: string;
    volumeTiers: Array<{ minQty: number; pricePerUnitCents: number }> | null;
    hourlyRateCents: number | null;
    durationMin: number;
    sessionCount: number;
    bookingEnabled: boolean;
    deliverables: string[] | null;
    locationType: string;
    bufferMinutes: number;
    minLeadHours: number;
    paymentPlans: PaymentPlan[];
    royaltyTerms: {
      master: { mode: "none" };
      composition: { mode: "none" };
    };
    agreementText: string | null;
    active: boolean;
    archivedAt: Date | null;
  };
  producerName: string;
  taxMode: string;
  taxRatePct: number;
};

class QueuedSelectQuery implements PromiseLike<unknown[]> {
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

class QueuedAcceptanceDb {
  readonly #selectRows: unknown[][];
  transactionCalls = 0;

  constructor(...selectRows: unknown[][]) {
    this.#selectRows = [...selectRows];
  }

  select(): QueuedSelectQuery {
    const rows = this.#selectRows.shift();
    if (!rows) throw new Error("Unexpected select in Store acceptance test double");
    return new QueuedSelectQuery(rows);
  }

  async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this as unknown as Db);
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function context(
  patch: {
    request?: Partial<AcceptanceContextFixture["request"]>;
    product?: Partial<AcceptanceContextFixture["product"]>;
    producerName?: string;
    taxMode?: string;
    taxRatePct?: number;
  } = {},
): AcceptanceContextFixture {
  const producerId = randomUUID();
  const clientContactId = randomUUID();
  const productId = randomUUID();
  return {
    request: {
      id: randomUUID(),
      producerId,
      clientContactId,
      productId,
      projectId: null,
      status: "approved",
      requestedSongQty: null,
      artistName: "SK-95 Artist",
      artistEmail: "sk95-artist@example.invalid",
      ...patch.request,
    },
    product: {
      id: productId,
      producerId,
      name: "SK-95 Mix",
      description: "A release-ready mix",
      kind: "mix",
      pricingModel: "flat",
      priceCents: 100_000,
      currency: "ILS",
      volumeTiers: null,
      hourlyRateCents: null,
      durationMin: 60,
      sessionCount: 1,
      bookingEnabled: true,
      deliverables: ["Stereo WAV"],
      locationType: "remote",
      bufferMinutes: 0,
      minLeadHours: 12,
      paymentPlans: [{ kind: "full" }],
      royaltyTerms: {
        master: { mode: "none" },
        composition: { mode: "none" },
      },
      agreementText: "Final exact Store terms.",
      active: true,
      archivedAt: null,
      ...patch.product,
    },
    producerName: patch.producerName ?? "SK-95 Studio",
    taxMode: patch.taxMode ?? "tax_free",
    taxRatePct: patch.taxRatePct ?? 18,
  };
}

async function storeError(operation: Promise<unknown>): Promise<StoreAcceptanceError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(StoreAcceptanceError);
    return error as StoreAcceptanceError;
  }
  throw new Error("Expected StoreAcceptanceError");
}

function preview(
  fixture: AcceptanceContextFixture,
  selectedPaymentPlan: PaymentPlan,
  targetTitle = "Existing project",
) {
  const targetUpdatedAt = new Date("2026-07-18T12:00:00.000Z");
  const rows =
    fixture.request.projectId === null
      ? ([[fixture]] as unknown[][])
      : ([
          [fixture],
          [
            {
              id: fixture.request.projectId,
              title: targetTitle,
              lifecycleStatus: "active",
              workflowStage: "production",
              updatedAt: targetUpdatedAt,
            },
          ],
        ] as unknown[][]);
  return previewStorePurchaseAcceptance(new QueuedAcceptanceDb(...rows).asDb(), {
    clerkUserId: "artist-clerk",
    purchaseRequestId: fixture.request.id,
    selectedPaymentPlan,
  });
}

describe("Store acceptance preview and plan allowlisting", () => {
  it("returns the exact enabled plan and deterministic schedule", async () => {
    const fixture = context({
      product: {
        paymentPlans: [
          { kind: "full" },
          { kind: "split_50_50" },
          { kind: "monthly", installments: 4 },
        ],
      },
    });

    const result = await preview(fixture, { kind: "split_50_50" });
    expect(result.snapshot.selectedPaymentPlan).toEqual({ kind: "split_50_50" });
    expect(result.snapshot.offeredPaymentPlans).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 4 },
    ]);
    expect(result.schedule).toEqual([
      {
        sequence: 1,
        trigger: "acceptance",
        label: "50% due at acceptance",
        amountCents: 50_000,
      },
      {
        sequence: 2,
        trigger: "artist_approval",
        label: "50% due when the artist approves the final version",
        amountCents: 50_000,
      },
    ]);
    expect(result.snapshot.agreementText).toContain("Exact installment schedule:");
    expect(result.snapshot.agreementText).toContain("ILS 500.00 [acceptance]");
  });

  it("rejects an unoffered plan in both preview and acceptance before any write", async () => {
    const fixture = context({ product: { paymentPlans: [{ kind: "full" }] } });
    const previewFailure = await storeError(
      preview(fixture, { kind: "split_50_50" }),
    );
    expect(previewFailure).toMatchObject({ code: "INVALID" });

    const db = new QueuedAcceptanceDb([fixture]);
    const acceptanceFailure = await storeError(
      acceptStorePurchase(db.asDb(), {
        clerkUserId: "artist-clerk",
        purchaseRequestId: fixture.request.id,
        selectedPaymentPlan: { kind: "monthly", installments: 4 },
        expectedSnapshotDigest: "stale-proposal",
        operationKey: "sk95-plan-not-offered",
        agreementAccepted: true,
      }),
    );
    expect(acceptanceFailure).toMatchObject({ code: "INVALID" });
    expect(db.transactionCalls).toBe(1);
  });

  it("requires approval before exposing commercial terms", async () => {
    const failure = await storeError(
      preview(context({ request: { status: "pending" } }), { kind: "full" }),
    );
    expect(failure).toMatchObject({ code: "NOT_APPROVED" });
  });
});

describe("Store acceptance proposal digest", () => {
  it("changes when product terms change and leaves the earlier preview immutable", async () => {
    const originalFixture = context();
    const original = await preview(originalFixture, { kind: "full" });
    const edited = await preview(
      context({
        request: {
          id: originalFixture.request.id,
          producerId: originalFixture.request.producerId,
          clientContactId: originalFixture.request.clientContactId,
          productId: originalFixture.request.productId,
        },
        product: {
          id: originalFixture.product.id,
          producerId: originalFixture.product.producerId,
          priceCents: 125_000,
          agreementText: "Edited future Store terms.",
        },
      }),
      { kind: "full" },
    );

    expect(edited.snapshotDigest).not.toBe(original.snapshotDigest);
    expect(edited.snapshot.totalCents).toBe(125_000);
    expect(original.snapshot.totalCents).toBe(100_000);
    expect(original.snapshot.agreementText).toContain("Final exact Store terms.");
    expect(original.snapshot.agreementText).not.toContain("Edited future Store terms.");
  });

  it("changes when only the same-client target changes", async () => {
    const base = context();
    const firstTarget = randomUUID();
    const secondTarget = randomUUID();
    const first = await preview(
      {
        ...base,
        request: { ...base.request, projectId: firstTarget },
      },
      { kind: "full" },
      "First project",
    );
    const second = await preview(
      {
        ...base,
        request: { ...base.request, projectId: secondTarget },
      },
      { kind: "full" },
      "Second project",
    );

    expect(second.snapshot).not.toEqual(first.snapshot);
    expect(second.snapshotDigest).not.toBe(first.snapshotDigest);
    expect(first.target).toEqual({
      kind: "existing",
      projectId: firstTarget,
      projectTitle: "First project",
      lifecycleStatus: "active",
      workflowStage: "production",
      updatedAtIso: "2026-07-18T12:00:00.000Z",
    });
    expect(second.target).toEqual({
      kind: "existing",
      projectId: secondTarget,
      projectTitle: "Second project",
      lifecycleStatus: "active",
      workflowStage: "production",
      updatedAtIso: "2026-07-18T12:00:00.000Z",
    });
  });

  it.each(["product edit", "target correction"] as const)(
    "rejects acceptance against a stale preview after a %s",
    async (change) => {
      const original = context();
      const previewed = await preview(original, { kind: "full" });
      const changed =
        change === "product edit"
          ? {
              ...original,
              product: { ...original.product, priceCents: 150_000 },
            }
          : {
              ...original,
              request: { ...original.request, projectId: randomUUID() },
            };
      const failure = await storeError(
        acceptStorePurchase(
          new QueuedAcceptanceDb(
            [changed],
            ...(changed.request.projectId === null
              ? []
              : [
                  [
                    {
                      id: changed.request.projectId,
                      title: "Corrected project",
                      lifecycleStatus: "active",
                      workflowStage: "production",
                      updatedAt: new Date("2026-07-18T12:00:00.000Z"),
                    },
                  ],
                ]),
          ).asDb(),
          {
          clerkUserId: "artist-clerk",
          purchaseRequestId: original.request.id,
          selectedPaymentPlan: { kind: "full" },
          expectedSnapshotDigest: previewed.snapshotDigest,
          operationKey: `sk95-stale-${change}`,
          agreementAccepted: true,
          },
        ),
      );
      expect(failure).toMatchObject({ code: "TERMS_CHANGED" });
      expect(failure.message).toMatch(/terms or project target changed/i);
    },
  );

  it("hides an existing target that is no longer eligible", async () => {
    const fixture = context({ request: { projectId: randomUUID() } });
    const failure = await storeError(
      previewStorePurchaseAcceptance(new QueuedAcceptanceDb([fixture], []).asDb(), {
        clerkUserId: "artist-clerk",
        purchaseRequestId: fixture.request.id,
        selectedPaymentPlan: { kind: "full" },
      }),
    );
    expect(failure).toMatchObject({
      code: "NOT_FOUND",
      message: "Purchase target was not found.",
    });
  });
});

describe("Store acceptance ownership privacy", () => {
  it("collapses foreign and missing request lookups to the same generic outcome", async () => {
    const missingId = randomUUID();
    const foreignId = randomUUID();
    const missing = await storeError(
      previewStorePurchaseAcceptance(new QueuedAcceptanceDb([]).asDb(), {
        clerkUserId: "artist-clerk",
        purchaseRequestId: missingId,
        selectedPaymentPlan: { kind: "full" },
      }),
    );
    const foreign = await storeError(
      previewStorePurchaseAcceptance(new QueuedAcceptanceDb([]).asDb(), {
        clerkUserId: "foreign-artist-clerk",
        purchaseRequestId: foreignId,
        selectedPaymentPlan: { kind: "full" },
      }),
    );

    expect({ code: foreign.code, message: foreign.message }).toEqual({
      code: missing.code,
      message: missing.message,
    });
    expect(missing).toMatchObject({
      code: "NOT_FOUND",
      message: "Purchase request was not found.",
    });
    expect(missing.message).not.toContain(missingId);
    expect(foreign.message).not.toContain(foreignId);
  });

  it("rejects acceptance without the exact agreement before touching the database", async () => {
    const db = new QueuedAcceptanceDb();
    const failure = await storeError(
      acceptStorePurchase(db.asDb(), {
        clerkUserId: "artist-clerk",
        purchaseRequestId: randomUUID(),
        selectedPaymentPlan: { kind: "full" },
        expectedSnapshotDigest: "proposal",
        operationKey: "sk95-not-accepted",
        agreementAccepted: false as true,
      }),
    );
    expect(failure).toMatchObject({ code: "INVALID" });
    expect(db.transactionCalls).toBe(0);
  });
});
