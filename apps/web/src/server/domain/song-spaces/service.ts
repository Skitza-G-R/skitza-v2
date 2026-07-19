import { createHash } from "node:crypto";

export type SongSpaceDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "OPERATION_KEY_CONFLICT"
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

/**
 * Immutable identity for one regular song-space allocation attempt. The
 * repository serializes this identity before looking up the deterministic
 * track id, so the same producer operation cannot race across projects.
 */
export type SongSpaceAllocationScope = SongSpaceScope &
  Readonly<{
    operationKey: string;
    songSpaceId: string;
  }>;

export type SongSpaceProjectScope = Readonly<{
  producerId: string;
  projectId: string;
}>;

export type SongSpacePurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";

const SONG_SPACE_PURCHASE_LIFECYCLE_STATUSES = new Set<string>([
  "waiting_for_payment",
  "active",
  "canceled",
]);

export type ActiveSongSpacePurchase = SongSpaceScope &
  Readonly<{
    lifecycleStatus: SongSpacePurchaseLifecycleStatus;
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
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

/**
 * One immutable purchase entitlement in a project's song-space read model.
 * Waiting and canceled purchases are included so already allocated tracks
 * remain attributable to their exact commercial source. Only active
 * purchases contribute unused virtual slots.
 */
export type SongSpacePurchaseRecord = SongSpaceScope &
  Readonly<{
    lifecycleStatus: SongSpacePurchaseLifecycleStatus;
    includedSongSpaces: number;
    acceptedAt: Date;
  }>;

export type SongSpaceProjectSnapshot = SongSpaceProjectScope &
  Readonly<{
    purchases: readonly SongSpacePurchaseRecord[];
    tracks: readonly SongSpaceRecord[];
  }>;

export type EmptySongSpaceSlot = Readonly<{
  id: string;
  kind: "empty";
  purchaseId: string;
  slotNumber: number;
  label: string;
}>;

export type SongSpaceProjectMode = "empty" | "single" | "album";

export type SongSpaceProjectSummary = Readonly<{
  tracks: readonly SongSpaceRecord[];
  emptySlots: readonly EmptySongSpaceSlot[];
  visibleCount: number;
  mode: SongSpaceProjectMode;
}>;

export interface SongSpaceAtomicTransaction {
  findSongSpaceByIdForUpdate(id: string): Promise<SongSpaceRecord | null>;
  getActivePurchaseForUpdate(scope: SongSpaceScope): Promise<ActiveSongSpacePurchase | null>;
  countPurchaseOwnedSongSpaces(scope: SongSpaceScope): Promise<number>;
  nextProjectPositionForUpdate(scope: SongSpaceScope): Promise<number>;
  insertSongSpace(input: SongSpaceRecord): Promise<SongSpaceRecord>;
  touchProject(scope: SongSpaceScope, changedAt: Date): Promise<void>;
}

export interface SongSpaceAtomicRepository {
  /**
   * The implementation must lock the immutable producer-operation identity,
   * then the project, then the exact purchase before invoking `work`. The
   * operation lock serializes deterministic-id lookup across projects; the
   * project lock serializes positions; the purchase lock serializes capacity.
   */
  atomically<T>(
    scope: SongSpaceAllocationScope,
    work: (transaction: SongSpaceAtomicTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SongSpaceReadRepository {
  /**
   * Loads all purchase entitlements and all allocated tracks for the exact
   * producer-owned project. The implementation must not filter archived,
   * waiting-payment, or canceled allocations: allocation is one-time and
   * those rows still consume their purchase's frozen capacity.
   */
  loadProjectSongSpaces(scope: SongSpaceProjectScope): Promise<SongSpaceProjectSnapshot | null>;
}

export type SongSpaceRepository = SongSpaceAtomicRepository & SongSpaceReadRepository;

export type CreateSongSpaceInput = SongSpaceScope &
  Readonly<{
    operationKey: string;
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

function assertOperationKey(value: string): string {
  const normalized = identifier(value, "operationKey");
  if (normalized.length > 200) {
    throw new SongSpaceDomainError("INVALID_INPUT", "operationKey must be at most 200 characters");
  }
  return normalized;
}

function deterministicSongSpaceId(producerId: string, operationKey: string): string {
  const digest = createHash("sha256")
    .update("skitza:purchase-owned-song-space:v1\0")
    .update(producerId)
    .update("\0")
    .update(operationKey)
    .digest("hex")
    .slice(0, 32);
  // UUIDv8 is reserved for application-defined deterministic layouts.
  const versioned = `${digest.slice(0, 12)}8${digest.slice(13, 16)}`;
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const normalized = `${versioned}${variant}${digest.slice(17)}`;
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function integrity(message: string): never {
  throw new SongSpaceDomainError("INTEGRITY_ERROR", message);
}

function assertSnapshotDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    integrity(`${label} must be a valid date`);
  }
}

function assertExactScope(
  actual: SongSpaceProjectScope,
  expected: SongSpaceProjectScope,
  label: string,
): void {
  if (actual.producerId !== expected.producerId || actual.projectId !== expected.projectId) {
    integrity(`${label} does not match the requested producer-owned project`);
  }
}

function assertCapacity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    integrity("Purchase song-space capacity is invalid");
  }
}

function snapshotIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    integrity(`${label} is invalid in the project song-space snapshot`);
  }
  return value;
}

function comparePurchases(left: SongSpacePurchaseRecord, right: SongSpacePurchaseRecord): number {
  const acceptedOrder = left.acceptedAt.getTime() - right.acceptedAt.getTime();
  return acceptedOrder !== 0 ? acceptedOrder : left.purchaseId.localeCompare(right.purchaseId);
}

function compareTracks(left: SongSpaceRecord, right: SongSpaceRecord): number {
  return left.position !== right.position
    ? left.position - right.position
    : left.id.localeCompare(right.id);
}

/**
 * Builds the stable project read model without pre-creating placeholder rows.
 * Every allocated track remains visible and consumes capacity. Unused capacity
 * appears as deterministic virtual slots only while its exact purchase is
 * active.
 */
export function summarizeProjectSongSpaces(
  input: SongSpaceProjectSnapshot,
): SongSpaceProjectSummary {
  const scope: SongSpaceProjectScope = {
    producerId: identifier(input.producerId, "producerId"),
    projectId: identifier(input.projectId, "projectId"),
  };
  const purchases = [...input.purchases];
  const tracks = [...input.tracks];
  const purchasesById = new Map<string, SongSpacePurchaseRecord>();
  const allocatedByPurchaseId = new Map<string, number>();
  const trackIds = new Set<string>();

  for (const purchase of purchases) {
    assertExactScope(purchase, scope, "Purchase entitlement");
    const purchaseId = snapshotIdentifier(purchase.purchaseId, "Purchase id");
    if (purchasesById.has(purchaseId)) {
      integrity("Project song-space snapshot contains a duplicate purchase");
    }
    if (!SONG_SPACE_PURCHASE_LIFECYCLE_STATUSES.has(purchase.lifecycleStatus)) {
      integrity("Purchase lifecycle status is invalid");
    }
    assertCapacity(purchase.includedSongSpaces);
    assertSnapshotDate(purchase.acceptedAt, "Purchase acceptedAt");
    purchasesById.set(purchaseId, purchase);
    allocatedByPurchaseId.set(purchaseId, 0);
  }

  for (const track of tracks) {
    assertExactScope(track, scope, "Allocated song space");
    const trackId = snapshotIdentifier(track.id, "Track id");
    const purchaseId = snapshotIdentifier(track.purchaseId, "Track purchase id");
    if (trackIds.has(trackId)) {
      integrity("Project song-space snapshot contains a duplicate track");
    }
    trackIds.add(trackId);
    if (!Number.isSafeInteger(track.position) || track.position < 0) {
      integrity("Allocated song-space position is invalid");
    }
    if (!purchasesById.has(purchaseId)) {
      integrity("Allocated song space has no exact purchase entitlement");
    }
    allocatedByPurchaseId.set(purchaseId, (allocatedByPurchaseId.get(purchaseId) ?? 0) + 1);
  }

  purchases.sort(comparePurchases);
  tracks.sort(compareTracks);

  const emptySlots: EmptySongSpaceSlot[] = [];
  for (const purchase of purchases) {
    const allocated = allocatedByPurchaseId.get(purchase.purchaseId) ?? 0;
    if (allocated > purchase.includedSongSpaces) {
      integrity("Allocated song spaces exceed their purchase capacity");
    }
    if (purchase.lifecycleStatus !== "active") continue;

    for (
      let slotNumber = allocated + 1;
      slotNumber <= purchase.includedSongSpaces;
      slotNumber += 1
    ) {
      emptySlots.push({
        id: `virtual:${purchase.purchaseId}:${String(slotNumber)}`,
        kind: "empty",
        purchaseId: purchase.purchaseId,
        slotNumber,
        label: `Song ${String(slotNumber)}`,
      });
    }
  }

  const visibleCount = tracks.length + emptySlots.length;
  if (!Number.isSafeInteger(visibleCount)) {
    integrity("Project song-space count is invalid");
  }

  return {
    tracks,
    emptySlots,
    visibleCount,
    mode: visibleCount === 0 ? "empty" : visibleCount === 1 ? "single" : "album",
  };
}

export async function getProjectSongSpaceSummary(
  repository: SongSpaceReadRepository,
  input: SongSpaceProjectScope,
): Promise<SongSpaceProjectSummary> {
  const scope: SongSpaceProjectScope = {
    producerId: identifier(input.producerId, "producerId"),
    projectId: identifier(input.projectId, "projectId"),
  };
  const snapshot = await repository.loadProjectSongSpaces(scope);
  if (!snapshot) {
    throw new SongSpaceDomainError("NOT_FOUND", "Producer-owned project not found");
  }
  assertExactScope(snapshot, scope, "Song-space snapshot");
  return summarizeProjectSongSpaces(snapshot);
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
  const operationKey = assertOperationKey(input.operationKey);
  const title = identifier(input.title, "title");
  const artist = input.artist?.trim() || null;
  const songSpaceId = deterministicSongSpaceId(scope.producerId, operationKey);
  assertDate(input.createdAt);

  const allocationScope: SongSpaceAllocationScope = {
    ...scope,
    operationKey,
    songSpaceId,
  };

  return repository.atomically(allocationScope, async (transaction) => {
    const existing = await transaction.findSongSpaceByIdForUpdate(songSpaceId);
    if (existing) {
      if (
        existing.producerId !== scope.producerId ||
        existing.projectId !== scope.projectId ||
        existing.purchaseId !== scope.purchaseId
      ) {
        throw new SongSpaceDomainError(
          "OPERATION_KEY_CONFLICT",
          "This operation key already belongs to a different project or purchase",
        );
      }
      // Title and featured artist are mutable project metadata. A transport
      // replay returns the original allocation even if either changed later.
      return existing;
    }

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
      throw new SongSpaceDomainError("INTEGRITY_ERROR", "Purchase song-space capacity is invalid");
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
      id: songSpaceId,
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
