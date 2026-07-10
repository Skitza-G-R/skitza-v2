import { describe, expect, it } from "vitest";

import {
  PURCHASE_APPROVAL_UNDO_MS,
  purchaseApprovalUndoableUntil,
} from "../request-helpers";

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
