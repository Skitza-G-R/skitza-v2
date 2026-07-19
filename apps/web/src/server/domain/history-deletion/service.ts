export type ClientDeletionSnapshot = Readonly<{
  id: string;
  producerId: string;
  clerkUserId: string | null;
  invitedAt: Date | null;
  artistArchivedAt: Date | null;
  producerArchivedAt: Date | null;
}>;

export type ProjectDeletionSnapshot = Readonly<{
  id: string;
  producerId: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
}>;

export type HistoricalDeletionTransaction = Readonly<{
  lockClient: (scope: {
    producerId: string;
    clientId: string;
  }) => Promise<ClientDeletionSnapshot | null>;
  lockProject: (scope: {
    producerId: string;
    projectId: string;
  }) => Promise<ProjectDeletionSnapshot | null>;
  clientHasHistory: (scope: { producerId: string; clientId: string }) => Promise<boolean>;
  projectHasHistory: (scope: { producerId: string; projectId: string }) => Promise<boolean>;
  deleteClient: (scope: { producerId: string; clientId: string }) => Promise<boolean>;
  deleteProject: (scope: { producerId: string; projectId: string }) => Promise<boolean>;
}>;

export type HistoricalDeletionRepository = Readonly<{
  atomically: <T>(
    scope: { kind: "client" | "project"; id: string },
    work: (transaction: HistoricalDeletionTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export class HistoricalDeletionDomainError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_EMPTY_DRAFT" | "HISTORY_EXISTS",
    message: string,
  ) {
    super(message);
    this.name = "HistoricalDeletionDomainError";
  }
}

function isTrulyEmptyDraftClient(client: ClientDeletionSnapshot): boolean {
  return (
    client.clerkUserId === null &&
    client.invitedAt === null &&
    client.artistArchivedAt === null &&
    client.producerArchivedAt === null
  );
}

/**
 * Advisory visibility check for the permanent-delete control. It uses
 * the same lock, ownership boundary, empty-draft predicate, and history
 * lookup as deletion itself. The mutation still rechecks everything in
 * its own transaction, so a concurrent history write can never turn
 * this advisory result into deletion authority.
 */
export async function canPermanentlyDeleteEmptyDraftClient(
  repository: HistoricalDeletionRepository,
  scope: Readonly<{ producerId: string; clientId: string }>,
): Promise<boolean> {
  return repository.atomically({ kind: "client", id: scope.clientId }, async (transaction) => {
    const client = await transaction.lockClient(scope);
    if (!client || client.producerId !== scope.producerId || !isTrulyEmptyDraftClient(client)) {
      return false;
    }
    return !(await transaction.clientHasHistory(scope));
  });
}

export async function permanentlyDeleteEmptyDraftClient(
  repository: HistoricalDeletionRepository,
  scope: Readonly<{ producerId: string; clientId: string }>,
): Promise<{ deleted: true }> {
  return repository.atomically({ kind: "client", id: scope.clientId }, async (transaction) => {
    const client = await transaction.lockClient(scope);
    if (!client || client.producerId !== scope.producerId) {
      throw new HistoricalDeletionDomainError("NOT_FOUND", "The client was not found");
    }
    if (!isTrulyEmptyDraftClient(client)) {
      throw new HistoricalDeletionDomainError(
        "NOT_EMPTY_DRAFT",
        "Only a truly empty draft client can be permanently deleted",
      );
    }
    if (await transaction.clientHasHistory(scope)) {
      throw new HistoricalDeletionDomainError(
        "HISTORY_EXISTS",
        "This client has history and cannot be permanently deleted",
      );
    }
    if (!(await transaction.deleteClient(scope))) {
      throw new HistoricalDeletionDomainError("NOT_FOUND", "The client was not found");
    }
    return { deleted: true };
  });
}

/**
 * Advisory visibility check for the empty-project delete control. The delete
 * mutation repeats the same locked checks, so this result is never treated as
 * authorization and may safely become stale between render and click.
 */
export async function canPermanentlyDeleteEmptyDraftProject(
  repository: HistoricalDeletionRepository,
  scope: Readonly<{ producerId: string; projectId: string }>,
): Promise<boolean> {
  return repository.atomically({ kind: "project", id: scope.projectId }, async (transaction) => {
    const project = await transaction.lockProject(scope);
    if (
      !project ||
      project.producerId !== scope.producerId ||
      project.lifecycleStatus !== "waiting_for_payment"
    ) {
      return false;
    }
    return !(await transaction.projectHasHistory(scope));
  });
}

export async function permanentlyDeleteEmptyDraftProject(
  repository: HistoricalDeletionRepository,
  scope: Readonly<{ producerId: string; projectId: string }>,
): Promise<{ deleted: true }> {
  return repository.atomically({ kind: "project", id: scope.projectId }, async (transaction) => {
    const project = await transaction.lockProject(scope);
    if (!project || project.producerId !== scope.producerId) {
      throw new HistoricalDeletionDomainError("NOT_FOUND", "The project was not found");
    }
    if (project.lifecycleStatus !== "waiting_for_payment") {
      throw new HistoricalDeletionDomainError(
        "NOT_EMPTY_DRAFT",
        "Only a truly empty draft project can be permanently deleted",
      );
    }
    if (await transaction.projectHasHistory(scope)) {
      throw new HistoricalDeletionDomainError(
        "HISTORY_EXISTS",
        "This project has history and cannot be permanently deleted",
      );
    }
    if (!(await transaction.deleteProject(scope))) {
      throw new HistoricalDeletionDomainError("NOT_FOUND", "The project was not found");
    }
    return { deleted: true };
  });
}
