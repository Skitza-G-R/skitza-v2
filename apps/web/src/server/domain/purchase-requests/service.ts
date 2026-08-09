import { createHash } from "node:crypto";

export type PurchaseRequestStatus = "pending" | "approved" | "declined" | "canceled" | "converted";

export type PurchaseRequestIntent = Readonly<{
  productId: string;
  projectId: string | null;
  requestedSongQty: number | null;
  brief: string | null;
}>;

export type PurchaseRequestOperation = Readonly<{
  operationKey: string;
  operationDigest: string;
}>;

export type ExistingRequestOperation = Readonly<{
  operationKey: string;
  operationDigest: string;
}>;

export type PurchaseRequestTransitionAction = "approve" | "decline";

export type PurchaseRequestTransition = Readonly<{
  changed: boolean;
  status: PurchaseRequestStatus;
  approvedAt: Date | null;
  declinedAt: Date | null;
  statusChangedAt: Date;
}>;

export type PurchaseRequestDomainErrorCode =
  | "INVALID_INPUT"
  | "OPERATION_KEY_CONFLICT"
  | "INVALID_TRANSITION";

export class PurchaseRequestDomainError extends Error {
  readonly code: PurchaseRequestDomainErrorCode;

  constructor(code: PurchaseRequestDomainErrorCode, message: string) {
    super(message);
    this.name = "PurchaseRequestDomainError";
    this.code = code;
  }
}

function canonicalRequestIntent(intent: PurchaseRequestIntent): string {
  return JSON.stringify({
    brief: intent.brief,
    productId: intent.productId,
    projectId: intent.projectId,
    requestedSongQty: intent.requestedSongQty,
  });
}

export function preparePurchaseRequestOperation(
  operationKey: string,
  intent: PurchaseRequestIntent,
): PurchaseRequestOperation {
  if (operationKey.trim().length === 0 || operationKey.length > 200) {
    throw new PurchaseRequestDomainError(
      "INVALID_INPUT",
      "operationKey must be an opaque non-empty value of at most 200 characters",
    );
  }
  if (intent.productId.trim().length === 0) {
    throw new PurchaseRequestDomainError("INVALID_INPUT", "productId must not be empty");
  }
  if (
    intent.requestedSongQty !== null &&
    (!Number.isSafeInteger(intent.requestedSongQty) || intent.requestedSongQty < 1)
  ) {
    throw new PurchaseRequestDomainError(
      "INVALID_INPUT",
      "requestedSongQty must be a positive integer when supplied",
    );
  }

  return {
    operationKey,
    operationDigest: createHash("sha256").update(canonicalRequestIntent(intent)).digest("hex"),
  };
}

export function assertPurchaseRequestOperationReplay(
  existing: ExistingRequestOperation,
  incoming: PurchaseRequestOperation,
): void {
  if (existing.operationKey !== incoming.operationKey) {
    throw new PurchaseRequestDomainError(
      "INVALID_INPUT",
      "Cannot compare purchase request operations with different keys",
    );
  }
  if (existing.operationDigest !== incoming.operationDigest) {
    throw new PurchaseRequestDomainError(
      "OPERATION_KEY_CONFLICT",
      "This operation key already belongs to a different purchase request intent",
    );
  }
}

export function transitionPurchaseRequest(
  request: Readonly<{
    status: PurchaseRequestStatus;
    approvedAt: Date | null;
    declinedAt: Date | null;
    statusChangedAt: Date | null;
    createdAt: Date;
  }>,
  action: PurchaseRequestTransitionAction,
  now: Date,
): PurchaseRequestTransition {
  if (Number.isNaN(now.getTime())) {
    throw new PurchaseRequestDomainError("INVALID_INPUT", "Transition time must be valid");
  }

  const unchanged = (): PurchaseRequestTransition => ({
    changed: false,
    status: request.status,
    approvedAt: request.approvedAt,
    declinedAt: request.declinedAt,
    statusChangedAt: request.statusChangedAt ?? request.createdAt,
  });

  if (action === "approve") {
    if (request.status === "approved") return unchanged();
    if (request.status !== "pending") {
      throw new PurchaseRequestDomainError(
        "INVALID_TRANSITION",
        `Cannot approve a ${request.status} request`,
      );
    }
    return {
      changed: true,
      status: "approved",
      approvedAt: now,
      declinedAt: null,
      statusChangedAt: now,
    };
  }

  if (request.status === "declined") return unchanged();
  if (request.status !== "pending") {
    throw new PurchaseRequestDomainError(
      "INVALID_TRANSITION",
      `Cannot decline a ${request.status} request`,
    );
  }
  return {
    changed: true,
    status: "declined",
    approvedAt: null,
    declinedAt: now,
    statusChangedAt: now,
  };
}
