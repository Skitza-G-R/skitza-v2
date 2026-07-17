export type SongSpaceDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CAPACITY_EXCEEDED"
  | "INTEGRITY_ERROR";

export class SongSpaceDomainError extends Error {
  readonly code: SongSpaceDomainErrorCode;

  constructor(code: SongSpaceDomainErrorCode, message: string) {
    super(message);
    this.name = "SongSpaceDomainError";
    this.code = code;
  }
}

export type SongSpaceScope = Readonly<{
  producerId: string;
  projectId: string;
  purchaseId: string;
}>;

export type ActiveSongSpacePurchase = SongSpaceScope &
  Readonly<{
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus:
      | "waiting_for_payment"
      | "active"
      | "paused"
      | "completed"
      | "canceled";
    includedSongSpaces: number;
  }>;

export type SongSpaceRecord = SongSpaceScope &
  Readonly<{
    id: string;
    title: string;
    artist: string | null;
    position: number;
  }>;

export type NewSongSpaceRecord = Omit<SongSpaceRecord, "id">;

export interface SongSpaceAtomicTransaction {
  getActivePurchaseForUpdate(scope: SongSpaceScope): Promise<ActiveSongSpacePurchase | null>;
  countPurchaseOwnedSongSpaces(scope: SongSpaceScope): Promise<number>;
  nextProjectPositionForUpdate(scope: SongSpaceScope): Promise<number>;
  insertSongSpace(input: NewSongSpaceRecord): Promise<SongSpaceRecord>;
  touchProject(scope: SongSpaceScope, changedAt: Date): Promise<void>;
}

export interface SongSpaceAtomicRepository {
  /**
   * The implementation must lock the project and then the exact purchase in a
   * stable order before invoking `work`. The project lock serializes positions;
   * the purchase lock serializes its commercial capacity check.
   */
  atomically<T>(
    scope: SongSpaceScope,
    work: (transaction: SongSpaceAtomicTransaction) => Promise<T>,
  ): Promise<T>;
}

export type CreateSongSpaceInput = SongSpaceScope &
  Readonly<{
    title: string;
    artist?: string | null;
    createdAt: Date;
  }>;

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new SongSpaceDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  return normalized;
}

function assertDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new SongSpaceDomainError("INVALID_INPUT", "createdAt must be a valid date");
  }
}

export async function createPurchaseOwnedSongSpace(
  repository: SongSpaceAtomicRepository,
  input: CreateSongSpaceInput,
): Promise<SongSpaceRecord> {
  const scope: SongSpaceScope = {
    producerId: identifier(input.producerId, "producerId"),
    projectId: identifier(input.projectId, "projectId"),
    purchaseId: identifier(input.purchaseId, "purchaseId"),
  };
  const title = identifier(input.title, "title");
  const artist = input.artist?.trim() || null;
  assertDate(input.createdAt);

  return repository.atomically(scope, async (transaction) => {
    const purchase = await transaction.getActivePurchaseForUpdate(scope);
    if (
      !purchase ||
      purchase.lifecycleStatus !== "active" ||
      purchase.projectLifecycleStatus !== "active" ||
      purchase.producerId !== scope.producerId ||
      purchase.projectId !== scope.projectId ||
      purchase.purchaseId !== scope.purchaseId
    ) {
      throw new SongSpaceDomainError("NOT_FOUND", "Active owned project purchase not found");
    }
    if (!Number.isSafeInteger(purchase.includedSongSpaces) || purchase.includedSongSpaces < 0) {
      throw new SongSpaceDomainError(
        "INTEGRITY_ERROR",
        "Purchase song-space capacity is invalid",
      );
    }
    const ownedCount = await transaction.countPurchaseOwnedSongSpaces(scope);
    if (!Number.isSafeInteger(ownedCount) || ownedCount < 0) {
      throw new SongSpaceDomainError("INTEGRITY_ERROR", "Owned song-space count is invalid");
    }
    if (ownedCount >= purchase.includedSongSpaces) {
      throw new SongSpaceDomainError(
        "CAPACITY_EXCEEDED",
        "This purchase has no remaining song spaces",
      );
    }

    const position = await transaction.nextProjectPositionForUpdate(scope);
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new SongSpaceDomainError("INTEGRITY_ERROR", "Next song-space position is invalid");
    }
    const row = await transaction.insertSongSpace({
      ...scope,
      title,
      artist,
      position,
    });
    if (
      row.producerId !== scope.producerId ||
      row.projectId !== scope.projectId ||
      row.purchaseId !== scope.purchaseId ||
      row.position !== position
    ) {
      throw new SongSpaceDomainError(
        "INTEGRITY_ERROR",
        "Inserted song space does not match its locked purchase scope",
      );
    }
    await transaction.touchProject(scope, new Date(input.createdAt));
    return row;
  });
}
