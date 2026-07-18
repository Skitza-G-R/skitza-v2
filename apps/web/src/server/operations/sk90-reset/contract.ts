import { assertSha256Digest, sameDigest, type Sha256Digest } from "./canonical";
import { stop } from "./errors";

/**
 * The full confirmed pre-reset public-table inventory: 19 schema-source tables
 * plus the zero-row live-only legacy residue. Locking preserved tables as well
 * as reset tables prevents the final preserved/object cross-reference from
 * changing under the transaction.
 */
export const REQUIRED_PRE_RESET_TABLES = [
  "agreement_acceptances",
  "availability_blackouts",
  "availability_blocks",
  "bookings",
  "client_contacts",
  "invoices",
  "notifications",
  "payment_proofs",
  "portfolio_tracks",
  "producer_external_links",
  "producer_notes",
  "producers",
  "products",
  "project_tracks",
  "projects",
  "purchase_requests",
  "store_purchase_intents",
  "stripe_customers",
  "track_comments",
  "track_versions",
] as const;

export type ResetFingerprintSnapshot = Readonly<{
  manifestDigest: Sha256Digest;
  schemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  storageReferencesFingerprint: Sha256Digest;
}>;

export type LockEvidence = Readonly<{
  table: string;
  mode: string;
}>;

export type FinalLockedSnapshotEvidence = Readonly<{
  isolationLevel: string;
  advisoryLockAcquired: boolean;
  mutationStarted: boolean;
  storageDeletionStarted: boolean;
  locks: readonly LockEvidence[];
  reviewed: ResetFingerprintSnapshot;
  underLock: ResetFingerprintSnapshot;
}>;

function assertSnapshotShape(snapshot: ResetFingerprintSnapshot): void {
  assertSha256Digest(snapshot.manifestDigest);
  assertSha256Digest(snapshot.schemaFingerprint);
  assertSha256Digest(snapshot.resetRowsFingerprint);
  assertSha256Digest(snapshot.preservedRowCountsFingerprint);
  assertSha256Digest(snapshot.preservedBusinessFingerprint);
  assertSha256Digest(snapshot.storageReferencesFingerprint);
}

function exactLocksPresent(locks: readonly LockEvidence[]): boolean {
  if (locks.length !== REQUIRED_PRE_RESET_TABLES.length) return false;
  const observed = new Map<string, string>();
  for (const lock of locks) {
    if (observed.has(lock.table) || lock.mode !== "share_row_exclusive") return false;
    observed.set(lock.table, lock.mode);
  }
  return REQUIRED_PRE_RESET_TABLES.every((table) => observed.has(table));
}

function snapshotsMatch(
  reviewed: ResetFingerprintSnapshot,
  underLock: ResetFingerprintSnapshot,
): boolean {
  return (
    sameDigest(reviewed.manifestDigest, underLock.manifestDigest) &&
    sameDigest(reviewed.schemaFingerprint, underLock.schemaFingerprint) &&
    sameDigest(reviewed.resetRowsFingerprint, underLock.resetRowsFingerprint) &&
    sameDigest(reviewed.preservedRowCountsFingerprint, underLock.preservedRowCountsFingerprint) &&
    sameDigest(reviewed.preservedBusinessFingerprint, underLock.preservedBusinessFingerprint) &&
    sameDigest(reviewed.storageReferencesFingerprint, underLock.storageReferencesFingerprint)
  );
}

/**
 * Final gate immediately before mutation. The caller must collect `underLock`
 * inside the same serializable transaction represented by `locks`.
 */
export function assertFinalLockedSnapshot(
  evidence: FinalLockedSnapshotEvidence,
): ResetFingerprintSnapshot {
  assertSnapshotShape(evidence.reviewed);
  assertSnapshotShape(evidence.underLock);

  if (
    evidence.isolationLevel !== "serializable" ||
    !evidence.advisoryLockAcquired ||
    evidence.mutationStarted ||
    evidence.storageDeletionStarted ||
    !exactLocksPresent(evidence.locks)
  ) {
    stop("LOCK_CONTRACT_INVALID");
  }

  if (!snapshotsMatch(evidence.reviewed, evidence.underLock)) {
    stop("FINAL_DRIFT_DETECTED");
  }

  return evidence.underLock;
}
