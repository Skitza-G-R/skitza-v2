import { describe, expect, it } from "vitest";

import {
  isApprovalUndoAvailable,
  PURCHASE_APPROVAL_UNDO_WINDOW_MS,
  purchaseApprovalUndoDeadline,
} from "~/lib/purchase/approval-undo";

describe("purchase request approval undo window", () => {
  const now = Date.parse("2026-07-11T12:00:00.000Z");

  it("derives the shared five-minute deadline from approval time", () => {
    const approvedAt = new Date(now);
    const deadline = purchaseApprovalUndoDeadline(approvedAt);

    expect(deadline.getTime() - approvedAt.getTime()).toBe(PURCHASE_APPROVAL_UNDO_WINDOW_MS);
    expect(PURCHASE_APPROVAL_UNDO_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("keeps a future undo deadline available", () => {
    expect(isApprovalUndoAvailable("2026-07-11T12:04:59.000Z", now)).toBe(true);
    expect(isApprovalUndoAvailable(new Date("2026-07-11T12:04:59.000Z"), now)).toBe(true);
  });

  it("closes the window at the exact deadline", () => {
    expect(isApprovalUndoAvailable("2026-07-11T12:00:00.000Z", now)).toBe(false);
  });

  it("rejects expired, missing, and malformed deadlines", () => {
    expect(isApprovalUndoAvailable("2026-07-11T11:59:59.999Z", now)).toBe(false);
    expect(isApprovalUndoAvailable(null, now)).toBe(false);
    expect(isApprovalUndoAvailable("not-a-date", now)).toBe(false);
  });
});
