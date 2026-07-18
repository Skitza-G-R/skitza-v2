import {
  assertProtectedToken,
  assertSha256Digest,
  compareUtf8Bytes,
  sameDigest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { stop } from "./errors";

export type StorageReference = Readonly<{
  bucketRole: "audio" | "docs";
  protectedKey: ProtectedToken;
  referencedBy: "reset" | "preserved";
  exists: boolean;
  ownershipVerified: boolean;
  contentFingerprint: Sha256Digest;
}>;

export type StorageDeletionCandidate = Readonly<{
  bucketRole: "audio" | "docs";
  protectedKey: ProtectedToken;
  contentFingerprint: Sha256Digest;
}>;

export type StorageDeletionPlan = Readonly<{
  candidates: readonly StorageDeletionCandidate[];
  preservedObjectCount: number;
}>;

type StorageReferenceGroup = {
  bucketRole: "audio" | "docs";
  protectedKey: ProtectedToken;
  contentFingerprint: Sha256Digest;
  referencedByReset: boolean;
  referencedByPreserved: boolean;
};

function storageIdentity(reference: StorageReference): string {
  return `${reference.bucketRole}\0${reference.protectedKey}`;
}

function assertStorageReferenceShape(reference: StorageReference): void {
  const raw = reference as {
    bucketRole: unknown;
    referencedBy: unknown;
    exists: unknown;
    ownershipVerified: unknown;
  };
  if (
    (raw.bucketRole !== "audio" && raw.bucketRole !== "docs") ||
    (raw.referencedBy !== "reset" && raw.referencedBy !== "preserved") ||
    typeof raw.exists !== "boolean" ||
    typeof raw.ownershipVerified !== "boolean"
  ) {
    stop("MANIFEST_INPUT_INVALID");
  }
}

/**
 * Normalize protected references into an exact deletion plan. A future storage
 * adapter may receive only the reset-exclusive candidates; shared, missing,
 * unverified, or content-drifted objects stop here first.
 */
export function deriveStorageDeletionPlan(
  references: readonly StorageReference[],
): StorageDeletionPlan {
  const groups = new Map<string, StorageReferenceGroup>();

  for (const reference of references) {
    assertStorageReferenceShape(reference);
    assertProtectedToken(reference.protectedKey);
    assertSha256Digest(reference.contentFingerprint);
    if (!reference.exists) stop("STORAGE_OBJECT_MISSING");
    if (!reference.ownershipVerified) stop("STORAGE_OWNERSHIP_UNVERIFIED");

    const identity = storageIdentity(reference);
    const existing = groups.get(identity);
    if (existing) {
      if (!sameDigest(existing.contentFingerprint, reference.contentFingerprint)) {
        stop("STORAGE_OBJECT_DRIFT");
      }
      if (reference.referencedBy === "reset") existing.referencedByReset = true;
      else existing.referencedByPreserved = true;
      continue;
    }

    groups.set(identity, {
      bucketRole: reference.bucketRole,
      protectedKey: reference.protectedKey,
      contentFingerprint: reference.contentFingerprint,
      referencedByReset: reference.referencedBy === "reset",
      referencedByPreserved: reference.referencedBy === "preserved",
    });
  }

  const ordered = [...groups.values()].sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedKey}`,
      `${right.bucketRole}:${right.protectedKey}`,
    ),
  );
  const candidates: StorageDeletionCandidate[] = [];
  let preservedObjectCount = 0;

  for (const group of ordered) {
    if (group.referencedByReset && group.referencedByPreserved) {
      stop("STORAGE_OBJECT_SHARED");
    }
    if (group.referencedByPreserved) {
      preservedObjectCount += 1;
      continue;
    }
    if (group.referencedByReset) {
      candidates.push({
        bucketRole: group.bucketRole,
        protectedKey: group.protectedKey,
        contentFingerprint: group.contentFingerprint,
      });
    }
  }

  return { candidates, preservedObjectCount };
}
