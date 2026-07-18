export type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type ProjectWorkflowStage = "brief" | "production" | "mixing" | "mastering" | "done";

export type ProjectLifecycleProjectRecord = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  deadlineAt: Date | null;
  workflowStage: ProjectWorkflowStage;
  lifecycleStatus: ProjectLifecycleStatus;
  lifecycleChangedAt: Date;
  updatedAt: Date;
}>;

export type ProjectLifecyclePurchaseStatus = "waiting_for_payment" | "active" | "canceled";

export type ProjectLifecyclePurchaseRecord = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  lifecycleStatus: ProjectLifecyclePurchaseStatus;
  canceledAt: Date | null;
  updatedAt: Date;
}>;

export type ProjectLifecycleClientRecord = Readonly<{
  id: string;
  producerId: string;
  producerArchivedAt: Date | null;
}>;

export type ProjectLifecycleAtomicScope =
  | Readonly<{ kind: "project"; producerId: string; projectId: string }>
  | Readonly<{ kind: "reopen"; producerId: string; projectId: string }>
  | Readonly<{ kind: "graph"; producerId: string; projectId: string }>
  | Readonly<{
      kind: "purchase";
      producerId: string;
      projectId: string;
      purchaseId: string;
    }>;

export type ProjectMetadataPatch = Readonly<{
  title?: string;
  deadlineAt?: Date | null;
  workflowStage?: ProjectWorkflowStage;
}>;

export interface ProjectLifecycleTransaction {
  readonly project: ProjectLifecycleProjectRecord | null;
  /** Present only for the client-serialized reopen boundary. */
  readonly reopenClient: ProjectLifecycleClientRecord | null;
  readonly purchases: readonly ProjectLifecyclePurchaseRecord[];
  updateProjectMetadata(
    input: Readonly<{
      producerId: string;
      projectId: string;
      patch: ProjectMetadataPatch;
      changedAt: Date;
    }>,
  ): Promise<ProjectLifecycleProjectRecord | null>;
  transitionProject(
    input: Readonly<{
      producerId: string;
      projectId: string;
      from: ProjectLifecycleStatus;
      to: ProjectLifecycleStatus;
      changedAt: Date;
    }>,
  ): Promise<ProjectLifecycleProjectRecord | null>;
  cancelPurchase(
    input: Readonly<{
      producerId: string;
      projectId: string;
      purchaseId: string;
      from: Exclude<ProjectLifecyclePurchaseStatus, "canceled">;
      canceledAt: Date;
    }>,
  ): Promise<ProjectLifecyclePurchaseRecord | null>;
  cancelFutureInstallments(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      canceledAt: Date;
    }>,
  ): Promise<number>;
  closeOpenAllowances(
    input: Readonly<{
      producerId: string;
      purchaseIds: readonly string[];
      reason: "project_completed" | "project_canceled" | "purchase_canceled";
      closedAt: Date;
    }>,
  ): Promise<number>;
  insertPurchaseCancellation(
    input: Readonly<{
      producerId: string;
      purchaseId: string;
      reason: string;
      actorId: string;
      canceledAt: Date;
    }>,
  ): Promise<boolean>;
}

export interface ProjectLifecycleRepository {
  atomically<T>(
    scope: ProjectLifecycleAtomicScope,
    work: (transaction: ProjectLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

export type ProjectLifecycleDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_CHANGE"
  | "INTEGRITY_ERROR";

export const PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE = "Restore this client before reopening";

export class ProjectLifecycleDomainError extends Error {
  constructor(
    readonly code: ProjectLifecycleDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectLifecycleDomainError";
  }
}

export type EditProjectInput = Readonly<{
  producerId: string;
  projectId: string;
  title?: string;
  deadlineAt?: Date | null;
  workflowStage?: ProjectWorkflowStage;
  changedAt: Date;
}>;

export type ProjectMutationResult = Readonly<{
  project: ProjectLifecycleProjectRecord;
  changed: boolean;
}>;

export type CompleteProjectInput = Readonly<{
  producerId: string;
  projectId: string;
  completedAt: Date;
}>;

export type CompleteProjectResult = ProjectMutationResult & Readonly<{ closedAllowances: number }>;

export type CancelProjectInput = Readonly<{
  producerId: string;
  projectId: string;
  actorId: string;
  reason: string;
  canceledAt: Date;
}>;

export type CancelProjectResult = ProjectMutationResult &
  Readonly<{
    canceledPurchaseIds: readonly string[];
    canceledInstallments: number;
    closedAllowances: number;
  }>;

export type ReopenProjectInput = Readonly<{
  producerId: string;
  projectId: string;
  reopenedAt: Date;
}>;

export type CancelProjectPurchaseInput = Readonly<{
  producerId: string;
  projectId: string;
  purchaseId: string;
  actorId: string;
  reason: string;
  canceledAt: Date;
}>;

export type CancelProjectPurchaseResult = Readonly<{
  project: ProjectLifecycleProjectRecord;
  purchase: ProjectLifecyclePurchaseRecord;
  changed: boolean;
  canceledInstallments: number;
  closedAllowances: number;
}>;

const WORKFLOW_STAGES: ReadonlySet<string> = new Set([
  "brief",
  "production",
  "mixing",
  "mastering",
  "done",
]);

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProjectLifecycleDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  return normalized;
}

function requiredText(value: string, label: string, maximum?: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProjectLifecycleDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  if (maximum !== undefined && normalized.length > maximum) {
    throw new ProjectLifecycleDomainError(
      "INVALID_INPUT",
      `${label} must be at most ${String(maximum)} characters`,
    );
  }
  return normalized;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProjectLifecycleDomainError("INVALID_INPUT", `${label} must be a valid date`);
  }
  return new Date(value);
}

function optionalDate(value: Date | null, label: string): Date | null {
  return value === null ? null : validDate(value, label);
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === null || right === null ? left === right : left.getTime() === right.getTime();
}

function notFound(): ProjectLifecycleDomainError {
  return new ProjectLifecycleDomainError("NOT_FOUND", "The project was not found");
}

function invalidTransition(
  from: ProjectLifecycleStatus,
  action: string,
): ProjectLifecycleDomainError {
  return new ProjectLifecycleDomainError(
    "INVALID_TRANSITION",
    `A ${from} project cannot be ${action}`,
  );
}

function concurrentChange(message: string): ProjectLifecycleDomainError {
  return new ProjectLifecycleDomainError("CONCURRENT_CHANGE", message);
}

function integrityError(message: string): never {
  throw new ProjectLifecycleDomainError("INTEGRITY_ERROR", message);
}

function ownedProject(
  candidate: ProjectLifecycleProjectRecord | null,
  scope: Readonly<{ producerId: string; projectId: string }>,
): ProjectLifecycleProjectRecord {
  if (!candidate || candidate.id !== scope.projectId || candidate.producerId !== scope.producerId) {
    throw notFound();
  }
  return candidate;
}

function lockedPurchases(
  candidates: readonly ProjectLifecyclePurchaseRecord[],
  scope: Readonly<{ producerId: string; projectId: string }>,
): readonly ProjectLifecyclePurchaseRecord[] {
  const seen = new Set<string>();
  const rows = [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  for (const row of rows) {
    if (
      seen.has(row.id) ||
      row.producerId !== scope.producerId ||
      row.projectId !== scope.projectId
    ) {
      integrityError("The locked purchase graph does not match the project owner");
    }
    seen.add(row.id);
  }
  return rows;
}

function lockedReopenClient(
  candidate: ProjectLifecycleClientRecord | null,
  project: ProjectLifecycleProjectRecord,
): ProjectLifecycleClientRecord {
  if (
    !candidate ||
    candidate.id !== project.clientContactId ||
    candidate.producerId !== project.producerId
  ) {
    integrityError("The locked client does not match the stable project owner");
  }
  return candidate;
}

function assertCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    integrityError(`${label} returned an invalid affected-row count`);
  }
  return value;
}

function assertTransitionedProject(
  updated: ProjectLifecycleProjectRecord | null,
  previous: ProjectLifecycleProjectRecord,
  expectedStatus: ProjectLifecycleStatus,
  changedAt: Date,
): ProjectLifecycleProjectRecord {
  if (
    !updated ||
    updated.id !== previous.id ||
    updated.producerId !== previous.producerId ||
    updated.clientContactId !== previous.clientContactId ||
    updated.lifecycleStatus !== expectedStatus ||
    !sameDate(updated.lifecycleChangedAt, changedAt) ||
    !sameDate(updated.updatedAt, changedAt)
  ) {
    throw concurrentChange("The project lifecycle changed concurrently");
  }
  return updated;
}

function assertCanceledPurchase(
  updated: ProjectLifecyclePurchaseRecord | null,
  previous: ProjectLifecyclePurchaseRecord,
  canceledAt: Date,
): ProjectLifecyclePurchaseRecord {
  if (
    !updated ||
    updated.id !== previous.id ||
    updated.producerId !== previous.producerId ||
    updated.projectId !== previous.projectId ||
    updated.lifecycleStatus !== "canceled" ||
    !sameDate(updated.canceledAt, canceledAt) ||
    !sameDate(updated.updatedAt, canceledAt)
  ) {
    throw concurrentChange("The purchase lifecycle changed concurrently");
  }
  return updated;
}

async function cancelLockedPurchase(
  transaction: ProjectLifecycleTransaction,
  purchase: ProjectLifecyclePurchaseRecord,
  input: Readonly<{
    producerId: string;
    projectId: string;
    actorId: string;
    reason: string;
    canceledAt: Date;
  }>,
): Promise<Readonly<{ purchase: ProjectLifecyclePurchaseRecord; canceledInstallments: number }>> {
  if (purchase.lifecycleStatus === "canceled") {
    return { purchase, canceledInstallments: 0 };
  }

  const canceledInstallments = assertCount(
    await transaction.cancelFutureInstallments({
      producerId: input.producerId,
      purchaseId: purchase.id,
      canceledAt: input.canceledAt,
    }),
    "Installment cancellation",
  );
  const updated = assertCanceledPurchase(
    await transaction.cancelPurchase({
      producerId: input.producerId,
      projectId: input.projectId,
      purchaseId: purchase.id,
      from: purchase.lifecycleStatus,
      canceledAt: input.canceledAt,
    }),
    purchase,
    input.canceledAt,
  );
  const cancellationInserted = await transaction.insertPurchaseCancellation({
    producerId: input.producerId,
    purchaseId: purchase.id,
    reason: input.reason,
    actorId: input.actorId,
    canceledAt: input.canceledAt,
  });
  if (!cancellationInserted) {
    integrityError("The immutable purchase cancellation could not be recorded");
  }
  return { purchase: updated, canceledInstallments };
}

export async function editProject(
  repository: ProjectLifecycleRepository,
  rawInput: EditProjectInput,
): Promise<ProjectMutationResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const projectId = identifier(rawInput.projectId, "Project id");
  const changedAt = validDate(rawInput.changedAt, "Project edit time");
  const title =
    rawInput.title === undefined ? undefined : requiredText(rawInput.title, "Project title", 120);
  const deadlineAt =
    rawInput.deadlineAt === undefined
      ? undefined
      : optionalDate(rawInput.deadlineAt, "Project deadline");
  const workflowStage = rawInput.workflowStage;
  if (workflowStage !== undefined && !WORKFLOW_STAGES.has(workflowStage)) {
    throw new ProjectLifecycleDomainError("INVALID_INPUT", "Project workflow stage is invalid");
  }

  return repository.atomically({ kind: "project", producerId, projectId }, async (transaction) => {
    const current = ownedProject(transaction.project, { producerId, projectId });
    const patch: {
      title?: string;
      deadlineAt?: Date | null;
      workflowStage?: ProjectWorkflowStage;
    } = {};
    if (title !== undefined && title !== current.title) patch.title = title;
    if (deadlineAt !== undefined && !sameDate(deadlineAt, current.deadlineAt)) {
      patch.deadlineAt = deadlineAt;
    }
    if (workflowStage !== undefined && workflowStage !== current.workflowStage) {
      patch.workflowStage = workflowStage;
    }
    if (Object.keys(patch).length === 0) return { project: current, changed: false };

    const updated = await transaction.updateProjectMetadata({
      producerId,
      projectId,
      patch,
      changedAt,
    });
    if (
      !updated ||
      updated.id !== current.id ||
      updated.producerId !== current.producerId ||
      updated.clientContactId !== current.clientContactId ||
      updated.lifecycleStatus !== current.lifecycleStatus ||
      !sameDate(updated.updatedAt, changedAt)
    ) {
      throw concurrentChange("The project changed concurrently during editing");
    }
    return { project: updated, changed: true };
  });
}

export async function completeProject(
  repository: ProjectLifecycleRepository,
  rawInput: CompleteProjectInput,
): Promise<CompleteProjectResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const projectId = identifier(rawInput.projectId, "Project id");
  const completedAt = validDate(rawInput.completedAt, "Project completion time");

  return repository.atomically({ kind: "graph", producerId, projectId }, async (transaction) => {
    const current = ownedProject(transaction.project, { producerId, projectId });
    if (current.lifecycleStatus === "completed") {
      return { project: current, changed: false, closedAllowances: 0 };
    }
    if (current.lifecycleStatus !== "active" && current.lifecycleStatus !== "paused") {
      throw invalidTransition(current.lifecycleStatus, "completed");
    }
    const purchases = lockedPurchases(transaction.purchases, { producerId, projectId });
    const closedAllowances = assertCount(
      await transaction.closeOpenAllowances({
        producerId,
        purchaseIds: purchases.map((row) => row.id),
        reason: "project_completed",
        closedAt: completedAt,
      }),
      "Session allowance closure",
    );
    const updated = assertTransitionedProject(
      await transaction.transitionProject({
        producerId,
        projectId,
        from: current.lifecycleStatus,
        to: "completed",
        changedAt: completedAt,
      }),
      current,
      "completed",
      completedAt,
    );
    return { project: updated, changed: true, closedAllowances };
  });
}

export async function cancelProject(
  repository: ProjectLifecycleRepository,
  rawInput: CancelProjectInput,
): Promise<CancelProjectResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const projectId = identifier(rawInput.projectId, "Project id");
  const actorId = identifier(rawInput.actorId, "Cancellation actor");
  const reason = requiredText(rawInput.reason, "Cancellation reason");
  const canceledAt = validDate(rawInput.canceledAt, "Project cancellation time");

  return repository.atomically({ kind: "graph", producerId, projectId }, async (transaction) => {
    const current = ownedProject(transaction.project, { producerId, projectId });
    if (current.lifecycleStatus === "canceled") {
      return {
        project: current,
        changed: false,
        canceledPurchaseIds: [],
        canceledInstallments: 0,
        closedAllowances: 0,
      };
    }
    if (
      current.lifecycleStatus !== "waiting_for_payment" &&
      current.lifecycleStatus !== "active" &&
      current.lifecycleStatus !== "paused"
    ) {
      throw invalidTransition(current.lifecycleStatus, "canceled");
    }

    const purchases = lockedPurchases(transaction.purchases, { producerId, projectId });
    const canceledPurchaseIds: string[] = [];
    let canceledInstallments = 0;
    for (const purchase of purchases) {
      if (purchase.lifecycleStatus === "canceled") continue;
      const result = await cancelLockedPurchase(transaction, purchase, {
        producerId,
        projectId,
        actorId,
        reason,
        canceledAt,
      });
      canceledPurchaseIds.push(result.purchase.id);
      canceledInstallments += result.canceledInstallments;
      if (!Number.isSafeInteger(canceledInstallments)) {
        integrityError("Installment cancellation count overflowed");
      }
    }

    const closedAllowances = assertCount(
      await transaction.closeOpenAllowances({
        producerId,
        purchaseIds: purchases.map((row) => row.id),
        reason: "project_canceled",
        closedAt: canceledAt,
      }),
      "Session allowance closure",
    );
    const updated = assertTransitionedProject(
      await transaction.transitionProject({
        producerId,
        projectId,
        from: current.lifecycleStatus,
        to: "canceled",
        changedAt: canceledAt,
      }),
      current,
      "canceled",
      canceledAt,
    );
    return {
      project: updated,
      changed: true,
      canceledPurchaseIds,
      canceledInstallments,
      closedAllowances,
    };
  });
}

export async function reopenProject(
  repository: ProjectLifecycleRepository,
  rawInput: ReopenProjectInput,
): Promise<ProjectMutationResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const projectId = identifier(rawInput.projectId, "Project id");
  const reopenedAt = validDate(rawInput.reopenedAt, "Project reopen time");

  return repository.atomically({ kind: "reopen", producerId, projectId }, async (transaction) => {
    const current = ownedProject(transaction.project, { producerId, projectId });
    const client = lockedReopenClient(transaction.reopenClient, current);
    if (client.producerArchivedAt !== null) {
      throw new ProjectLifecycleDomainError(
        "INVALID_TRANSITION",
        PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
      );
    }
    if (current.lifecycleStatus === "active") return { project: current, changed: false };
    if (current.lifecycleStatus !== "completed" && current.lifecycleStatus !== "canceled") {
      throw invalidTransition(current.lifecycleStatus, "reopened");
    }
    const updated = assertTransitionedProject(
      await transaction.transitionProject({
        producerId,
        projectId,
        from: current.lifecycleStatus,
        to: "active",
        changedAt: reopenedAt,
      }),
      current,
      "active",
      reopenedAt,
    );
    return { project: updated, changed: true };
  });
}

export async function cancelProjectPurchase(
  repository: ProjectLifecycleRepository,
  rawInput: CancelProjectPurchaseInput,
): Promise<CancelProjectPurchaseResult> {
  const producerId = identifier(rawInput.producerId, "Producer id");
  const projectId = identifier(rawInput.projectId, "Project id");
  const purchaseId = identifier(rawInput.purchaseId, "Purchase id");
  const actorId = identifier(rawInput.actorId, "Cancellation actor");
  const reason = requiredText(rawInput.reason, "Cancellation reason");
  const canceledAt = validDate(rawInput.canceledAt, "Purchase cancellation time");

  return repository.atomically(
    { kind: "purchase", producerId, projectId, purchaseId },
    async (transaction) => {
      const currentProject = ownedProject(transaction.project, { producerId, projectId });
      const purchases = lockedPurchases(transaction.purchases, { producerId, projectId });
      const currentPurchase = purchases[0];
      if (!currentPurchase || purchases.length !== 1 || currentPurchase.id !== purchaseId) {
        throw new ProjectLifecycleDomainError("NOT_FOUND", "The purchase was not found");
      }
      if (currentPurchase.lifecycleStatus === "canceled") {
        return {
          project: currentProject,
          purchase: currentPurchase,
          changed: false,
          canceledInstallments: 0,
          closedAllowances: 0,
        };
      }

      const canceled = await cancelLockedPurchase(transaction, currentPurchase, {
        producerId,
        projectId,
        actorId,
        reason,
        canceledAt,
      });
      const closedAllowances = assertCount(
        await transaction.closeOpenAllowances({
          producerId,
          purchaseIds: [purchaseId],
          reason: "purchase_canceled",
          closedAt: canceledAt,
        }),
        "Session allowance closure",
      );
      return {
        project: currentProject,
        purchase: canceled.purchase,
        changed: true,
        canceledInstallments: canceled.canceledInstallments,
        closedAllowances,
      };
    },
  );
}
