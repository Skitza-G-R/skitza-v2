export const PURCHASE_APPROVAL_UNDO_WINDOW_MS = 5 * 60 * 1000;

export function purchaseApprovalUndoDeadline(approvedAt: Date): Date {
  return new Date(approvedAt.getTime() + PURCHASE_APPROVAL_UNDO_WINDOW_MS);
}

export function isApprovalUndoAvailable(
  undoableUntil: Date | string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!undoableUntil) return false;

  const deadlineMs =
    undoableUntil instanceof Date ? undoableUntil.getTime() : Date.parse(undoableUntil);
  return Number.isFinite(deadlineMs) && deadlineMs > nowMs;
}
