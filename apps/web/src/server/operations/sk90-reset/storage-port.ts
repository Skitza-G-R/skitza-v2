import type { S3Client } from "@aws-sdk/client-s3";

import type { ProtectedToken, Sha256Digest } from "./canonical";

export type StorageBucketRole = "audio" | "docs";
export type StorageObjectOwnership = "reset_exclusive" | "preserved_only";
export type StorageSnapshotExpectation = "pre" | "post";
export type StorageNamespaceDataState = "pre" | "post" | "approved_subset";
export type StorageRecoveryState = "empty" | "approved_subset" | "complete";
export type StorageNamespaceStateObservation = Readonly<{
  dataState: "pre" | "post" | "partial";
  recoveryState: StorageRecoveryState;
}>;

/**
 * A deliberately small port makes the real adapter injectable. Tests can prove
 * every request without constructing an SDK client or contacting object storage.
 */
export type Sk90S3Client = Pick<S3Client, "send">;

/** Dedicated configuration only. No application R2 name or default is accepted. */
export type Sk90R2RehearsalConfig = Readonly<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Readonly<Record<StorageBucketRole, string>>;
  namespace: string;
}>;

export type RawKeyTokenInput = Readonly<{
  scope: "data" | "recovery";
  bucketRole: StorageBucketRole;
  key: string;
}>;

/** The caller owns the HMAC key; the storage adapter never receives it. */
export type RawKeyTokenHook = (input: RawKeyTokenInput) => ProtectedToken;

export type StorageObjectMetadata = Readonly<{
  cacheControl: string | null;
  contentDisposition: string | null;
  contentEncoding: string | null;
  contentLanguage: string | null;
  contentType: string | null;
  expiresAt: string | null;
  custom: readonly (readonly [key: string, value: string])[];
}>;

/**
 * This private envelope is never safe to log. Its raw key is usable only after
 * `RawKeyTokenHook` recomputes the exact protected token in the artifact.
 */
export type RawStorageEnvelopeEntry = Readonly<{
  bucketRole: StorageBucketRole;
  logicalKey: string;
  protectedKey: ProtectedToken;
  ownership: StorageObjectOwnership;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
}>;

export type RawStorageEnvelope = Readonly<{
  entries: readonly RawStorageEnvelopeEntry[];
}>;

export type ObservedStorageObject = RawStorageEnvelopeEntry &
  Readonly<{
    /** Private conditional-request value. Never include it in public evidence. */
    etag: string;
    lastModified: string;
  }>;

export type StorageNamespaceSnapshot = Readonly<{
  expectation: StorageSnapshotExpectation | "custom";
  objectCount: number;
  activeMultipartUploadCount: 0;
  objects: readonly ObservedStorageObject[];
  /** Excludes raw keys and ETags; includes protected identity, size, bytes, and metadata. */
  fingerprint: Sha256Digest;
}>;

export type StorageMutationCounters = Readonly<{
  copyAttempts: number;
  copiesSucceeded: number;
  deleteAttempts: number;
  deletesSucceeded: number;
}>;

export type QuarantineCopyReceipt = Readonly<{
  bucketRole: StorageBucketRole;
  protectedSourceKey: ProtectedToken;
  sourceContentFingerprint: Sha256Digest;
  protectedCopyKey: ProtectedToken;
  copyContentFingerprint: Sha256Digest;
  copyExists: true;
  restoreVerified: true;
}>;

export type QuarantineResult = Readonly<{
  sourceBeforeFingerprint: Sha256Digest;
  sourceAfterFingerprint: Sha256Digest;
  copies: readonly QuarantineCopyReceipt[];
}>;

export type StorageDeleteProgressReceipt = Readonly<{
  protectedKey: ProtectedToken;
  reconciled: boolean;
}>;

export type StorageDeleteResult = Readonly<{
  deletedCount: number;
  reconciledCount: number;
  deletedObjectsFingerprint: Sha256Digest;
  postSnapshot: StorageNamespaceSnapshot;
}>;

export type StorageRestoreProgressReceipt = Readonly<{
  protectedKey: ProtectedToken;
  alreadyPresent: boolean;
  replayed: boolean;
}>;

export type StorageRestoreResult = Readonly<{
  restoredCount: number;
  replayedCount: number;
  alreadyPresentCount: number;
  snapshot: StorageNamespaceSnapshot;
}>;

export type SecondRunStorageSnapshot = Readonly<{
  beforeFingerprint: Sha256Digest;
  afterFingerprint: Sha256Digest;
  copyAttempts: 0;
  copiesSucceeded: 0;
  deleteAttempts: 0;
  deletesSucceeded: 0;
  unchanged: true;
}>;

export type MaybePromise<Value> = Value | Promise<Value>;

export interface Sk90R2RehearsalAdapter {
  getMutationCounters(): StorageMutationCounters;

  /** Exhaustively reject every object/upload outside the exact phase-owned sets. */
  assertNamespaceState(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      dataState: StorageNamespaceDataState;
      recoveryState: StorageRecoveryState;
    }>,
  ): Promise<StorageNamespaceStateObservation>;

  captureStableSnapshot(
    envelope: RawStorageEnvelope,
    expectation: StorageSnapshotExpectation,
  ): Promise<StorageNamespaceSnapshot>;

  quarantineResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      assertAuthorizationFresh: () => MaybePromise<void>;
    }>,
  ): Promise<QuarantineResult>;

  deleteResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      completedProtectedKeys: readonly ProtectedToken[];
      mutationStarted: boolean;
      assertAuthorizationFresh: () => MaybePromise<void>;
      onProgress?: (receipt: StorageDeleteProgressReceipt) => MaybePromise<void>;
    }>,
  ): Promise<StorageDeleteResult>;

  restoreResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      forceReplay: boolean;
      assertAuthorizationFresh: () => MaybePromise<void>;
      onProgress?: (receipt: StorageRestoreProgressReceipt) => MaybePromise<void>;
    }>,
  ): Promise<StorageRestoreResult>;

  captureSecondRunStorageSnapshot(
    input: Readonly<{
      envelope: RawStorageEnvelope;
      expected: StorageSnapshotExpectation;
      beforeSnapshot: StorageNamespaceSnapshot;
      beforeCounters: StorageMutationCounters;
    }>,
  ): Promise<SecondRunStorageSnapshot>;
}
