import { describe, expect, it } from "vitest";

import {
  offeredPlans,
  planIsOffered,
  PURCHASE_APPROVAL_UNDO_MS,
  purchaseApprovalUndoableUntil,
} from "../request-helpers";

describe("purchase request payment plans", () => {
  it("returns every authored plan without mutating the product value", () => {
    const paymentPlans = [
      { kind: "full" as const },
      { kind: "split_50_50" as const },
      { kind: "monthly" as const, installments: 4 },
    ];

    const offered = offeredPlans({ paymentPlans });

    expect(offered).toEqual(paymentPlans);
    expect(offered).not.toBe(paymentPlans);
  });

  it("requires an exact installment count for monthly selections", () => {
    const offered = [{ kind: "monthly" as const, installments: 4 }];

    expect(planIsOffered({ kind: "monthly", installments: 4 }, offered)).toBe(true);
    expect(planIsOffered({ kind: "monthly", installments: 6 }, offered)).toBe(false);
    expect(planIsOffered({ kind: "full" }, offered)).toBe(false);
  });
});

describe("purchaseApprovalUndoableUntil", () => {
  const now = Date.UTC(2026, 6, 10, 12, 0, 0);

  it("returns the exact five-minute deadline for a fresh approval", () => {
    const approvedAt = new Date(now - 60_000);

    expect(purchaseApprovalUndoableUntil(approvedAt, now)).toEqual(
      new Date(approvedAt.getTime() + PURCHASE_APPROVAL_UNDO_MS),
    );
  });

  it("returns null when there was no approval or the undo window has expired", () => {
    expect(purchaseApprovalUndoableUntil(null, now)).toBeNull();
    expect(
      purchaseApprovalUndoableUntil(new Date(now - PURCHASE_APPROVAL_UNDO_MS), now),
    ).toBeNull();
  });
});
