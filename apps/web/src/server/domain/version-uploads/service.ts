export type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type PurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";

export type VersionUploadLifecycleScope = Readonly<{
  producerId: string;
  projectId: string;
  purchaseId: string;
}>;

export type VersionUploadLifecycleCandidate = VersionUploadLifecycleScope &
  Readonly<{
    projectLifecycleStatus: ProjectLifecycleStatus;
    purchaseLifecycleStatus: PurchaseLifecycleStatus;
  }>;

export type VersionUploadDomainErrorCode = "NOT_FOUND" | "INACTIVE";

export class VersionUploadDomainError extends Error {
  readonly code: VersionUploadDomainErrorCode;

  constructor(code: VersionUploadDomainErrorCode, message: string) {
    super(message);
    this.name = "VersionUploadDomainError";
    this.code = code;
  }
}

/**
 * Audio version history belongs to one immutable purchase. New placeholders,
 * presigned parts, and final object attachment are allowed only while both the
 * exact owning purchase and its project are active.
 */
export function assertActiveVersionUploadLifecycle(
  candidate: VersionUploadLifecycleCandidate | null,
  expected: VersionUploadLifecycleScope,
): VersionUploadLifecycleCandidate {
  if (
    !candidate ||
    candidate.producerId !== expected.producerId ||
    candidate.projectId !== expected.projectId ||
    candidate.purchaseId !== expected.purchaseId
  ) {
    throw new VersionUploadDomainError(
      "NOT_FOUND",
      "The purchase-owned version upload scope was not found",
    );
  }
  if (
    candidate.projectLifecycleStatus !== "active" ||
    candidate.purchaseLifecycleStatus !== "active"
  ) {
    throw new VersionUploadDomainError(
      "INACTIVE",
      "Audio versions can be changed only while the project and purchase are active",
    );
  }
  return candidate;
}
