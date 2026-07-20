import type { Db } from "@skitza/db";
import { describe, expect, it } from "vitest";

import {
  ensurePurchaseSessionAllowance,
  purchaseSessionAllowanceDraft,
  type PurchaseSessionAllowanceDraft,
} from "../db";
import { storePurchaseSourceKind } from "../store-acceptance";

type AllowancePurchase = Parameters<typeof purchaseSessionAllowanceDraft>[0];

const acceptedAt = new Date("2026-07-20T09:00:00.000Z");

function purchase(
  session: null | {
    limit: { kind: "fixed"; count: number } | { kind: "unlimited" };
    durationMin: number;
    locationType: string;
    bufferMinutes: number;
    minLeadHours: number;
  },
  sourceKind:
    | "store_product"
    | "session_product"
    | "private_offer"
    | "paid_add_on"
    | "no_charge_add_on" = session === null ? "store_product" : "session_product",
): AllowancePurchase {
  return {
    id: "purchase-sk68",
    producerId: "producer-sk68",
    source:
      sourceKind === "private_offer"
        ? {
            kind: sourceKind,
            productId: "product-sk68",
            privateOfferId: "offer-sk68",
            purchaseRequestId: null,
          }
        : {
            kind: sourceKind,
            productId: "product-sk68",
            privateOfferId: null,
            purchaseRequestId: "request-sk68",
          },
    commercialSnapshot: {
      value: { session },
      digest: "snapshot-sk68",
      canonicalJson: "{}",
    },
    acceptedAt,
  } as AllowancePurchase;
}

type StoredAllowance = PurchaseSessionAllowanceDraft & {
  id: string;
  closedAt: Date | null;
  closeReason: null;
};

class AllowanceTx {
  row: StoredAllowance | null = null;
  insertCalls = 0;
  insertedDrafts: PurchaseSessionAllowanceDraft[] = [];

  select() {
    const rows = this.row === null ? [] : [this.row];
    const query = {
      from: () => query,
      where: () => query,
      limit: () => Promise.resolve(rows),
    };
    return query;
  }

  insert() {
    this.insertCalls += 1;
    return {
      values: (draft: PurchaseSessionAllowanceDraft) => {
        this.insertedDrafts.push(draft);
        return {
          onConflictDoNothing: () => ({
            returning: () => {
              if (this.row !== null) return Promise.resolve([]);
              this.row = {
                ...draft,
                id: "allowance-sk68",
                closedAt: null,
                closeReason: null,
              };
              return Promise.resolve([this.row]);
            },
          }),
        };
      },
    };
  }

  asTransaction(): Parameters<typeof ensurePurchaseSessionAllowance>[0] {
    return this as unknown as Pick<Db, "select" | "insert" | "update" | "execute">;
  }
}

describe("purchase-owned session allowance materialization", () => {
  it("classifies new Store session purchases separately from non-session products", () => {
    const fixed = {
      limit: { kind: "fixed" as const, count: 2 },
      durationMin: 60,
      locationType: "remote",
      bufferMinutes: 15,
      minLeadHours: 24,
    };
    const unlimited = { ...fixed, limit: { kind: "unlimited" as const } };

    expect(storePurchaseSourceKind(null)).toBe("store_product");
    expect(storePurchaseSourceKind(fixed)).toBe("session_product");
    expect(storePurchaseSourceKind(unlimited)).toBe("session_product");
  });

  it("copies every fixed session term from immutable accepted truth", () => {
    expect(
      purchaseSessionAllowanceDraft(
        purchase({
          limit: { kind: "fixed", count: 4 },
          durationMin: 90,
          locationType: "studio",
          bufferMinutes: 20,
          minLeadHours: 36,
        }),
      ),
    ).toEqual({
      purchaseId: "purchase-sk68",
      producerId: "producer-sk68",
      kind: "fixed",
      sessionLimit: 4,
      durationMin: 90,
      locationType: "studio",
      bufferMinutes: 20,
      minLeadHours: 36,
      createdAt: acceptedAt,
    });
  });

  it("stores unlimited capacity with a null fixed limit", () => {
    expect(
      purchaseSessionAllowanceDraft(
        purchase({
          limit: { kind: "unlimited" },
          durationMin: 120,
          locationType: "remote",
          bufferMinutes: 0,
          minLeadHours: 12,
        }),
      ),
    ).toMatchObject({ kind: "unlimited", sessionLimit: null });
  });

  it("creates no allowance for an accepted non-session Store purchase", () => {
    expect(purchaseSessionAllowanceDraft(purchase(null, "store_product"))).toBeNull();
  });

  it("materializes legacy store_product session snapshots while rejecting missing session truth", () => {
    expect(
      purchaseSessionAllowanceDraft(
        purchase(
          {
            limit: { kind: "fixed", count: 1 },
            durationMin: 60,
            locationType: "remote",
            bufferMinutes: 0,
            minLeadHours: 12,
          },
          "store_product",
        ),
      ),
    ).toMatchObject({ kind: "fixed", sessionLimit: 1 });
    expect(() => purchaseSessionAllowanceDraft(purchase(null, "session_product"))).toThrow(
      /missing frozen session terms/i,
    );
  });

  it("inserts an identical allowance exactly once across an idempotent replay", async () => {
    const tx = new AllowanceTx();
    const accepted = purchase({
      limit: { kind: "fixed", count: 3 },
      durationMin: 60,
      locationType: "client_space",
      bufferMinutes: 15,
      minLeadHours: 24,
    });

    await ensurePurchaseSessionAllowance(tx.asTransaction(), accepted);
    await ensurePurchaseSessionAllowance(tx.asTransaction(), accepted);

    expect(tx.insertCalls).toBe(1);
    expect(tx.insertedDrafts).toHaveLength(1);
    expect(tx.row).toMatchObject({
      purchaseId: "purchase-sk68",
      kind: "fixed",
      sessionLimit: 3,
      durationMin: 60,
      locationType: "client_space",
      bufferMinutes: 15,
      minLeadHours: 24,
    });
  });

  it("rejects a replay when stored allowance terms differ from accepted truth", async () => {
    const tx = new AllowanceTx();
    tx.row = {
      ...(purchaseSessionAllowanceDraft(
        purchase({
          limit: { kind: "fixed", count: 2 },
          durationMin: 60,
          locationType: "remote",
          bufferMinutes: 0,
          minLeadHours: 12,
        }),
      ) as PurchaseSessionAllowanceDraft),
      id: "allowance-sk68",
      sessionLimit: 99,
      closedAt: null,
      closeReason: null,
    };

    await expect(
      ensurePurchaseSessionAllowance(
        tx.asTransaction(),
        purchase({
          limit: { kind: "fixed", count: 2 },
          durationMin: 60,
          locationType: "remote",
          bufferMinutes: 0,
          minLeadHours: 12,
        }),
      ),
    ).rejects.toThrow(/differs from frozen commercial terms/i);
  });

  it.each(["private_offer", "paid_add_on"] as const)(
    "materializes immutable session terms independently of %s provenance",
    (sourceKind) => {
      expect(
        purchaseSessionAllowanceDraft(
          purchase(
            {
              limit: { kind: "unlimited" },
              durationMin: 180,
              locationType: "studio",
              bufferMinutes: 30,
              minLeadHours: 48,
            },
            sourceKind,
          ),
        ),
      ).toMatchObject({
        kind: "unlimited",
        sessionLimit: null,
        durationMin: 180,
        locationType: "studio",
        bufferMinutes: 30,
        minLeadHours: 48,
      });
    },
  );
});
