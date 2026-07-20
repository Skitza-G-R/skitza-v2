import { createHash } from "node:crypto";

export const SONG_TITLE_MAX_LENGTH = 120;
export const ARTIST_CREDIT_MAX_LENGTH = 120;
export const VERSION_LABEL_MAX_LENGTH = 40;

export type SongManagementDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "AUDIO_PROTECTED"
  | "OPERATION_KEY_CONFLICT"
  | "INTEGRITY_ERROR"
  | "STORAGE_IDENTITY_MISMATCH"
  | "STORAGE_UNCERTAIN";

/** Stable codes let the transport map policy, conflict, and retryable failures separately. */
export class SongManagementDomainError extends Error {
  constructor(
    readonly code: SongManagementDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SongManagementDomainError";
  }
}

function invalidInput(message: string): never {
  throw new SongManagementDomainError("INVALID_INPUT", message);
}

function integrityError(message: string): never {
  throw new SongManagementDomainError("INTEGRITY_ERROR", message);
}

function normalizeRequiredText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string") invalidInput(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length === 0) invalidInput(`${label} must not be empty`);
  if (normalized.length > maximum) {
    invalidInput(`${label} must be at most ${String(maximum)} characters`);
  }
  return normalized;
}

export function normalizeSongTitle(value: string): string {
  return normalizeRequiredText(value, "Song title", SONG_TITLE_MAX_LENGTH);
}

export function normalizeArtistCredit(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalidInput("Artist credit must be text");
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > ARTIST_CREDIT_MAX_LENGTH) {
    invalidInput(`Artist credit must be at most ${String(ARTIST_CREDIT_MAX_LENGTH)} characters`);
  }
  return normalized;
}

export function normalizeVersionLabel(value: string): string {
  return normalizeRequiredText(value, "Version label", VERSION_LABEL_MAX_LENGTH);
}

export type SongArchiveIntent = "archive" | "restore";

export type SongArchiveChange = Readonly<{
  changed: boolean;
  nextArchivedAt: Date | null;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Plans only the row intent. Repeating the same request is a no-op, and an
 * already archived song keeps its original timestamp rather than looking newly archived.
 */
export function planSongArchiveChange(
  input: Readonly<{
    currentArchivedAt: Date | null;
    intent: SongArchiveIntent;
    changedAt: Date;
  }>,
): SongArchiveChange {
  if (!isValidDate(input.changedAt)) invalidInput("Song archive change time must be valid");
  if (input.currentArchivedAt !== null && !isValidDate(input.currentArchivedAt)) {
    integrityError("The stored song archive timestamp is invalid");
  }
  if (input.intent === "archive") {
    if (input.currentArchivedAt !== null) {
      return { changed: false, nextArchivedAt: new Date(input.currentArchivedAt) };
    }
    return { changed: true, nextArchivedAt: new Date(input.changedAt) };
  }

  return input.currentArchivedAt === null
    ? { changed: false, nextArchivedAt: null }
    : { changed: true, nextArchivedAt: null };
}

/**
 * A command timestamp can be captured before it waits for the per-song lock.
 * Keep committed lifecycle timestamps monotonic even when an older request
 * acquires that lock after a newer publication or deletion command.
 */
export function monotonicStoredAudioDeletionTime(
  input: Readonly<{
    requestedAt: Date;
    projectUpdatedAt: Date;
    songReleasedAt: Date | null;
    songArchivedAt: Date | null;
    portfolioPublishedAt: Date | null;
    versionUploadedAt: Date;
    versionMarkedFinalAt: Date | null;
    priorAudioDeletedAt: Date | null;
    linkCreatedAt: Date | null;
    linkEnabledAt: Date | null;
    linkDisabledAt: Date | null;
    linkUpdatedAt: Date | null;
    latestPublicEventAt: Date | null;
  }>,
): Date {
  if (!isValidDate(input.requestedAt)) invalidInput("Stored audio deletion time must be valid");

  const priorCommittedTimes = [
    input.projectUpdatedAt,
    input.songReleasedAt,
    input.songArchivedAt,
    input.portfolioPublishedAt,
    input.versionUploadedAt,
    input.versionMarkedFinalAt,
    input.priorAudioDeletedAt,
    input.linkCreatedAt,
    input.linkEnabledAt,
    input.linkDisabledAt,
    input.linkUpdatedAt,
    input.latestPublicEventAt,
  ];
  let effectiveTime = input.requestedAt.getTime();
  for (const priorTime of priorCommittedTimes) {
    if (priorTime === null) continue;
    if (!isValidDate(priorTime)) {
      integrityError("A stored public-audio lifecycle timestamp is invalid");
    }
    effectiveTime = Math.max(effectiveTime, priorTime.getTime());
  }
  return new Date(effectiveTime);
}

export type StoredAudioDeletionCandidate = Readonly<{
  /** The caller must supply only locked, completed, non-tombstoned audio rows. */
  versionId: string;
  uploadedAt: Date;
  producerMarkedFinalAt: Date | null;
}>;

export type StoredAudioDeletionProtection =
  | "LAST_STORED_AUDIO"
  | "CURRENT_STORED_AUDIO"
  | "PRODUCER_FINAL_AUDIO";

export type StoredAudioDeletionPolicyDecision =
  | Readonly<{
      allowed: true;
      protections: readonly [];
      /** Newest remaining stored audio, or null when release permits deleting the last one. */
      nextPlaybackVersionId: string | null;
    }>
  | Readonly<{
      allowed: false;
      protections: readonly StoredAudioDeletionProtection[];
      nextPlaybackVersionId: null;
    }>;

export type EvaluateStoredAudioDeletionPolicyInput = Readonly<{
  targetVersionId: string;
  /** Derived by the caller from its locked workflow state; this module does not name a DB stage. */
  isReleased: boolean;
  storedVersions: readonly StoredAudioDeletionCandidate[];
}>;

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== "string") invalidInput(`${label} must be text`);
  const normalized = value.trim();
  if (normalized.length === 0) invalidInput(`${label} must not be empty`);
  return normalized;
}

function assertStoredVersion(candidate: StoredAudioDeletionCandidate): void {
  if (
    typeof candidate.versionId !== "string" ||
    candidate.versionId.length === 0 ||
    candidate.versionId.trim() !== candidate.versionId
  ) {
    integrityError("A stored-audio version id is invalid");
  }
  if (!isValidDate(candidate.uploadedAt)) {
    integrityError("A stored-audio upload timestamp is invalid");
  }
  if (candidate.producerMarkedFinalAt !== null && !isValidDate(candidate.producerMarkedFinalAt)) {
    integrityError("A stored-audio final timestamp is invalid");
  }
}

function newestFirst(
  left: StoredAudioDeletionCandidate,
  right: StoredAudioDeletionCandidate,
): number {
  const leftTime = left.uploadedAt.getTime();
  const rightTime = right.uploadedAt.getTime();
  if (leftTime !== rightTime) return rightTime > leftTime ? 1 : -1;
  return right.versionId.localeCompare(left.versionId);
}

/**
 * Evaluates deletion from one locked snapshot. "Current" is the newest stored
 * audio by upload time, with version id as the deterministic tie-breaker.
 */
export function evaluateStoredAudioDeletionPolicy(
  input: EvaluateStoredAudioDeletionPolicyInput,
): StoredAudioDeletionPolicyDecision {
  const targetVersionId = normalizeIdentifier(input.targetVersionId, "Version id");
  if (typeof input.isReleased !== "boolean") invalidInput("Released state must be boolean");

  const seen = new Set<string>();
  for (const candidate of input.storedVersions) {
    assertStoredVersion(candidate);
    if (seen.has(candidate.versionId)) {
      integrityError("The locked stored-audio snapshot contains a duplicate version");
    }
    seen.add(candidate.versionId);
  }

  const target = input.storedVersions.find((candidate) => candidate.versionId === targetVersionId);
  if (!target) {
    throw new SongManagementDomainError(
      "NOT_FOUND",
      "The stored audio version was not found in the locked song snapshot",
    );
  }

  const ordered = [...input.storedVersions].sort(newestFirst);
  const remaining = ordered.filter((candidate) => candidate.versionId !== targetVersionId);

  if (!input.isReleased) {
    const protections: StoredAudioDeletionProtection[] = [];
    if (ordered.length === 1) protections.push("LAST_STORED_AUDIO");
    if (ordered[0]?.versionId === targetVersionId) protections.push("CURRENT_STORED_AUDIO");
    if (target.producerMarkedFinalAt !== null) protections.push("PRODUCER_FINAL_AUDIO");
    if (protections.length > 0) {
      return { allowed: false, protections, nextPlaybackVersionId: null };
    }
  }

  return {
    allowed: true,
    protections: [],
    nextPlaybackVersionId: remaining[0]?.versionId ?? null,
  };
}

/** Throws a transport-mappable policy error when a UI advisory decision is stale. */
export function assertStoredAudioDeletionAllowed(
  input: EvaluateStoredAudioDeletionPolicyInput,
): Extract<StoredAudioDeletionPolicyDecision, { allowed: true }> {
  const decision = evaluateStoredAudioDeletionPolicy(input);
  if (decision.allowed) return decision;

  const labels: Record<StoredAudioDeletionProtection, string> = {
    LAST_STORED_AUDIO: "the last stored audio",
    CURRENT_STORED_AUDIO: "the current audio",
    PRODUCER_FINAL_AUDIO: "producer-marked-final audio",
  };
  throw new SongManagementDomainError(
    "AUDIO_PROTECTED",
    `Before release, ${decision.protections.map((protection) => labels[protection]).join(", ")} cannot be deleted`,
  );
}

export type StoredAudioIdentity = Readonly<{
  key: string;
  objectEtag: string;
  sizeBytes: number;
  fingerprint: string;
}>;

export type StoredAudioIdentitySnapshot = Readonly<{
  key: string | null;
  objectEtag: string | null;
  sizeBytes: number | null;
  fingerprint: string | null;
}>;

export function computeStoredAudioIdentityFingerprint(
  input: Pick<StoredAudioIdentity, "key" | "objectEtag" | "sizeBytes">,
): string {
  if (
    typeof input.key !== "string" ||
    input.key.length === 0 ||
    input.key.trim() !== input.key ||
    typeof input.objectEtag !== "string" ||
    input.objectEtag.length === 0 ||
    input.objectEtag.trim() !== input.objectEtag ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    invalidInput("Stored audio identity fields are invalid");
  }
  const encodePart = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonicalIdentity = [
    "skitza-track-audio-v1",
    encodePart(input.key),
    encodePart(input.objectEtag),
    encodePart(input.sizeBytes.toString()),
  ].join("|");
  return `sha256:${createHash("sha256").update(canonicalIdentity, "utf8").digest("hex")}`;
}

/** Stable command identity for intent-idempotent stored-audio deletion audit events. */
export function storedAudioDeletionOperationDigest(
  input: Readonly<{
    producerId: string;
    trackId: string;
    purchaseId: string;
    versionId: string;
    actorClerkUserId: string;
  }>,
): string {
  const encodePart = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonicalIntent = [
    "skitza-stored-audio-deletion-v1",
    encodePart(input.producerId),
    encodePart(input.trackId),
    encodePart(input.purchaseId),
    encodePart(input.versionId),
    encodePart(input.actorClerkUserId),
  ].join("|");
  return `sha256:${createHash("sha256").update(canonicalIntent, "utf8").digest("hex")}`;
}

/**
 * Validates the immutable identity retained on a tombstoned history row. Audio
 * URL and deletion time are deliberately not inputs: neither proves which R2
 * object is safe to delete.
 */
export function requireHistorySafeStoredAudioIdentity(
  snapshot: StoredAudioIdentitySnapshot,
): StoredAudioIdentity {
  if (
    typeof snapshot.key !== "string" ||
    snapshot.key.length === 0 ||
    snapshot.key.trim() !== snapshot.key ||
    typeof snapshot.objectEtag !== "string" ||
    snapshot.objectEtag.length === 0 ||
    snapshot.objectEtag.trim() !== snapshot.objectEtag ||
    typeof snapshot.sizeBytes !== "number" ||
    !Number.isSafeInteger(snapshot.sizeBytes) ||
    snapshot.sizeBytes <= 0 ||
    typeof snapshot.fingerprint !== "string"
  ) {
    integrityError("The stored audio history row does not retain a complete immutable identity");
  }

  let expectedFingerprint: string;
  try {
    expectedFingerprint = computeStoredAudioIdentityFingerprint({
      key: snapshot.key,
      objectEtag: snapshot.objectEtag,
      sizeBytes: snapshot.sizeBytes,
    });
  } catch {
    integrityError("The stored audio history row has invalid identity fields");
  }
  if (snapshot.fingerprint !== expectedFingerprint) {
    integrityError("The stored audio history fingerprint does not match its immutable identity");
  }
  return {
    key: snapshot.key,
    objectEtag: snapshot.objectEtag,
    sizeBytes: snapshot.sizeBytes,
    fingerprint: snapshot.fingerprint,
  };
}

export type ExactAudioStorageObservation =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "erased_marker"; deletionFingerprint: string }>
  | Readonly<{ kind: "present"; objectEtag: string; sizeBytes: number }>;

/**
 * The adapter must observe one exact key with a fail-closed listing/HEAD
 * strategy. R2 does not document conditional DeleteObject, so destructive
 * authorization uses its documented conditional PutObject support instead:
 * the exact matching audio is atomically replaced by a lightweight deletion
 * marker, then that marker is removed with ordinary DeleteObject. The caller's
 * committed tombstone must permanently forbid all application writes to that
 * immutable version key; ordinary marker removal cannot defend against a
 * separate actor holding direct storage credentials.
 */
export type ExactAudioStoragePort = Readonly<{
  observeExactObject: (input: { key: string }) => Promise<ExactAudioStorageObservation>;
  conditionallyEraseExactObject: (input: {
    key: string;
    ifMatch: string;
    deletionFingerprint: string;
  }) => Promise<void>;
  deleteErasedMarker: (input: { key: string }) => Promise<void>;
}>;

export type ExactStoredAudioDeletionResult = Readonly<{
  kind: "already_absent" | "deleted" | "reconciled_after_ambiguous_delete";
}>;

function storageUncertain(message: string): never {
  throw new SongManagementDomainError("STORAGE_UNCERTAIN", message);
}

async function observeExactObject(
  storage: ExactAudioStoragePort,
  identity: StoredAudioIdentity,
): Promise<ExactAudioStorageObservation> {
  let observation: ExactAudioStorageObservation;
  try {
    observation = await storage.observeExactObject({ key: identity.key });
  } catch {
    storageUncertain("The exact stored audio object could not be observed safely");
  }
  if (observation.kind === "absent") return observation;
  if (observation.kind === "erased_marker") {
    if (
      typeof observation.deletionFingerprint !== "string" ||
      observation.deletionFingerprint.length === 0 ||
      observation.deletionFingerprint.trim() !== observation.deletionFingerprint
    ) {
      storageUncertain("The exact stored audio deletion marker was incomplete");
    }
    return observation;
  }
  if (
    typeof observation.objectEtag !== "string" ||
    observation.objectEtag.length === 0 ||
    observation.objectEtag.trim() !== observation.objectEtag ||
    !Number.isSafeInteger(observation.sizeBytes) ||
    observation.sizeBytes <= 0
  ) {
    storageUncertain("The exact stored audio observation was incomplete");
  }
  return observation;
}

function assertMatchingDeletionMarker(
  observation: Extract<ExactAudioStorageObservation, { kind: "erased_marker" }>,
  expected: StoredAudioIdentity,
): void {
  if (observation.deletionFingerprint !== expected.fingerprint) {
    throw new SongManagementDomainError(
      "STORAGE_IDENTITY_MISMATCH",
      "The exact storage key contains an unrelated deletion marker; it was not removed",
    );
  }
}

async function removeMatchingDeletionMarker(
  storage: ExactAudioStoragePort,
  identity: StoredAudioIdentity,
  priorResponseWasAmbiguous: boolean,
): Promise<ExactStoredAudioDeletionResult> {
  let markerDeleteResponseWasAmbiguous = false;
  try {
    await storage.deleteErasedMarker({ key: identity.key });
  } catch {
    markerDeleteResponseWasAmbiguous = true;
  }

  const afterDelete = await observeExactObject(storage, identity);
  if (afterDelete.kind === "absent") {
    return {
      kind:
        priorResponseWasAmbiguous || markerDeleteResponseWasAmbiguous
          ? "reconciled_after_ambiguous_delete"
          : "deleted",
    };
  }
  if (afterDelete.kind === "erased_marker") {
    assertMatchingDeletionMarker(afterDelete, identity);
    storageUncertain("The stored audio was erased but its deletion marker is still present");
  }
  throw new SongManagementDomainError(
    "STORAGE_IDENTITY_MISMATCH",
    "The exact storage key changed after audio erasure; no replacement object was deleted",
  );
}

function assertObservedIdentity(
  observation: Extract<ExactAudioStorageObservation, { kind: "present" }>,
  expected: StoredAudioIdentity,
): void {
  if (
    observation.objectEtag !== expected.objectEtag ||
    observation.sizeBytes !== expected.sizeBytes
  ) {
    throw new SongManagementDomainError(
      "STORAGE_IDENTITY_MISMATCH",
      "The exact storage key now identifies different audio; no replacement object was deleted",
    );
  }
}

/**
 * Reconciles one already-authorized deletion. It is safe to retry after a
 * crash or lost response: absence succeeds, a matching erasure marker is
 * cleaned up, a replacement before conditional erasure fails closed, and an
 * unobservable object never reports deletion as complete. Once the marker is
 * observed, safety relies on the application's no-same-key-write invariant
 * documented by ExactAudioStoragePort.
 */
export async function reconcileExactStoredAudioDeletion(
  storage: ExactAudioStoragePort,
  identitySnapshot: StoredAudioIdentitySnapshot,
): Promise<ExactStoredAudioDeletionResult> {
  const identity = requireHistorySafeStoredAudioIdentity(identitySnapshot);
  const before = await observeExactObject(storage, identity);
  if (before.kind === "absent") return { kind: "already_absent" };
  if (before.kind === "erased_marker") {
    assertMatchingDeletionMarker(before, identity);
    return removeMatchingDeletionMarker(storage, identity, true);
  }
  assertObservedIdentity(before, identity);

  let eraseResponseWasAmbiguous = false;
  try {
    await storage.conditionallyEraseExactObject({
      key: identity.key,
      ifMatch: identity.objectEtag,
      deletionFingerprint: identity.fingerprint,
    });
  } catch {
    // A timeout may happen before or after R2 commits the conditional erase. Only a new
    // exact observation decides whether this call is complete.
    eraseResponseWasAmbiguous = true;
  }

  const afterErase = await observeExactObject(storage, identity);
  if (afterErase.kind === "absent") {
    return {
      kind: eraseResponseWasAmbiguous ? "reconciled_after_ambiguous_delete" : "deleted",
    };
  }
  if (afterErase.kind === "erased_marker") {
    assertMatchingDeletionMarker(afterErase, identity);
    return removeMatchingDeletionMarker(storage, identity, eraseResponseWasAmbiguous);
  }
  assertObservedIdentity(afterErase, identity);
  storageUncertain("The matching stored audio object is still present after conditional erasure");
}
