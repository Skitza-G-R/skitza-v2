import { describe, expect, it } from "vitest";

import {
  assertPurchaseRequestOperationReplay,
  preparePurchaseRequestOperation,
  purchaseRequestApprovalUndoDeadline,
  transitionPurchaseRequest,
} from "../service";

const createdAt = new Date("2026-07-17T08:00:00.000Z");

describe("purchase request operations", () => {
  const intent = {
    productId: "product-1",
    projectId: null,
    requestedSongQty: 3,
    brief: "Three-song EP",
  } as const;

  it("creates a stable digest and accepts an exact retry", () => {
    const first = preparePurchaseRequestOperation("request-attempt-1", intent);
    const retry = preparePurchaseRequestOperation("request-attempt-1", { ...intent });

    expect(retry.operationDigest).toBe(first.operationDigest);
    expect(() => {
      assertPurchaseRequestOperationReplay(first, retry);
    }).not.toThrow();
  });

  it("rejects operation-key reuse for changed request intent", () => {
    const first = preparePurchaseRequestOperation("request-attempt-1", intent);
    const changed = preparePurchaseRequestOperation("request-attempt-1", {
      ...intent,
      requestedSongQty: 4,
    });

    expect(() => {
      assertPurchaseRequestOperationReplay(first, changed);
    }).toThrow(/different purchase request intent/);
  });
});

describe("purchase request transitions", () => {
  const pending = {
    status: "pending" as const,
    approvedAt: null,
    declinedAt: null,
    statusChangedAt: null,
    createdAt,
  };

  it("approves and declines only pending requests", () => {
    const now = new Date("2026-07-17T08:01:00.000Z");

    expect(transitionPurchaseRequest(pending, "approve", now)).toMatchObject({
      changed: true,
      status: "approved",
      approvedAt: now,
    });
    expect(transitionPurchaseRequest(pending, "decline", now)).toMatchObject({
      changed: true,
      status: "declined",
      declinedAt: now,
    });
    expect(() =>
      transitionPurchaseRequest({ ...pending, status: "converted" }, "approve", now),
    ).toThrow(/Cannot approve a converted request/);
  });

  it("makes repeated approve and decline decisions idempotent", () => {
    const approvedAt = new Date("2026-07-17T08:01:00.000Z");
    const declinedAt = new Date("2026-07-17T08:02:00.000Z");

    expect(
      transitionPurchaseRequest(
        {
          ...pending,
          status: "approved",
          approvedAt,
          statusChangedAt: approvedAt,
        },
        "approve",
        new Date("2026-07-17T08:03:00.000Z"),
      ),
    ).toMatchObject({ changed: false, status: "approved", approvedAt });
    expect(
      transitionPurchaseRequest(
        {
          ...pending,
          status: "declined",
          declinedAt,
          statusChangedAt: declinedAt,
        },
        "decline",
        new Date("2026-07-17T08:03:00.000Z"),
      ),
    ).toMatchObject({ changed: false, status: "declined", declinedAt });
  });

  it("allows approval undo only before the exact deadline", () => {
    const approvedAt = new Date("2026-07-17T08:01:00.000Z");
    const approved = {
      ...pending,
      status: "approved" as const,
      approvedAt,
      statusChangedAt: approvedAt,
    };
    const deadline = purchaseRequestApprovalUndoDeadline(approvedAt);

    expect(
      transitionPurchaseRequest(approved, "undo_approval", new Date(deadline.getTime() - 1)),
    ).toMatchObject({ changed: true, status: "pending", approvedAt: null });
    expect(() => transitionPurchaseRequest(approved, "undo_approval", deadline)).toThrow(
      /undo window has elapsed/i,
    );
  });
});
