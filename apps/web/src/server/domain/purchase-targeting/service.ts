export type MutablePurchaseRequestStatus = "pending" | "approved";
export type PurchaseTargetingStatus =
  | MutablePurchaseRequestStatus
  | "declined"
  | "canceled"
  | "converted";

export type PurchaseTargetingErrorCode = "NOT_FOUND" | "LOCKED";

export class PurchaseTargetingError extends Error {
  readonly code: PurchaseTargetingErrorCode;

  constructor(code: PurchaseTargetingErrorCode, message: string) {
    super(message);
    this.name = "PurchaseTargetingError";
    this.code = code;
  }
}
export function assertPurchaseTargetCanChange(input: {
  status: PurchaseTargetingStatus;
  hasAcceptedPurchase: boolean;
}): void {
  if (input.hasAcceptedPurchase || (input.status !== "pending" && input.status !== "approved")) {
    throw new PurchaseTargetingError(
      "LOCKED",
      "This purchase target is locked because acceptance or payment history has begun.",
    );
  }
}
