import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  and,
  eq,
  isNotNull,
  isNull,
  projectTracks,
  projects,
  purchases,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { BUCKETS, getR2, isAudioKeyForTrackVersion } from "~/server/storage/r2";
import {
  abortMultipartUploadAndObserve,
  exactObjectIsAbsent,
  listExactMultipartUploadIds,
} from "~/server/audio/multipart-storage-recovery";

const AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA = "skitza-upload-token";
const MULTIPART_CANCELLATION_SETTLE_MS = 60 * 1000;

export function canFinalizePendingMultipartCancellation(
  input: Readonly<{
    cancellationObservedAt: Date;
    createAttemptedAt: Date | null;
    completeAttemptedAt: Date | null;
    partUrlsExpireAt: Date | null;
    observedRemoteActivity: boolean;
    verifiedRemoteAbsence?: boolean;
    now: Date;
  }>,
): boolean {
  const observedAt = input.cancellationObservedAt.getTime();
  const now = input.now.getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(now) || observedAt > now) {
    return false;
  }
  if (input.verifiedRemoteAbsence === true) return true;
  if (input.observedRemoteActivity) return false;
  // A signed PUT may start before URL expiry and finish later, and a lost
  // CompleteMultipart response has the same open-ended ambiguity. Without a
  // provider terminal-state primitive, timers alone may never erase the only
  // durable owner for either capability.
  if (
    input.createAttemptedAt !== null ||
    input.partUrlsExpireAt !== null ||
    input.completeAttemptedAt !== null
  ) {
    return false;
  }
  if (now - observedAt < MULTIPART_CANCELLATION_SETTLE_MS) {
    return false;
  }
  return true;
}

export type PendingMultipartCancellationIdentity = Readonly<{
  key: string;
  uploadId: string;
  objectEtag: string | null;
  sizeBytes: number;
  completionToken: string;
}>;

export type PendingMultipartCancellationPort = Readonly<{
  abortExact(input: PendingMultipartCancellationIdentity): Promise<void>;
  head(key: string): Promise<Readonly<{
    eTag: string | undefined;
    sizeBytes: number | undefined;
    completionToken: string | undefined;
  }> | null>;
  publishDeleteIntent(
    input: PendingMultipartCancellationIdentity & Readonly<{ objectEtag: string }>,
  ): Promise<boolean>;
  deleteExact(input: Readonly<{ key: string; ifMatch: string }>): Promise<void>;
  clearExact(input: PendingMultipartCancellationIdentity): Promise<boolean>;
}>;

/**
 * Finish one exact, durably requested multipart cancellation. The caller must
 * publish the cancellation journal before invoking this function. Every
 * remote mutation is retryable: an already-aborted upload is accepted, and a
 * completion that won the race is identity-checked and conditionally removed.
 */
export async function reconcilePendingMultipartCancellation(
  input: PendingMultipartCancellationIdentity,
  port: PendingMultipartCancellationPort,
): Promise<boolean> {
  await port.abortExact(input);
  const observed = await port.head(input.key);
  if (observed === null) return port.clearExact(input);
  if (
    !pendingObjectIdentityMatches({
      expectedEtag: input.objectEtag,
      expectedSizeBytes: input.sizeBytes,
      expectedCompletionToken: input.completionToken,
      observedEtag: observed.eTag,
      observedSizeBytes: observed.sizeBytes,
      observedCompletionToken: observed.completionToken,
    })
  ) {
    return false;
  }

  const objectEtag = observed.eTag?.trim();
  if (!objectEtag) return false;
  const exactCompleted = { ...input, objectEtag };
  if (input.objectEtag === null && !(await port.publishDeleteIntent(exactCompleted))) {
    return false;
  }
  await port.deleteExact({ key: input.key, ifMatch: objectEtag });
  if ((await port.head(input.key)) !== null) return false;
  return port.clearExact(exactCompleted);
}

export type PendingMultipartCancellationExpectedIdentity = Readonly<{
  key: string;
  uploadId: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type PendingMultipartCancellationResult = Readonly<{
  kind: "canceled" | "already_deleted" | "no_pending";
  projectId: string;
}>;

export class PendingMultipartCancellationError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "INTEGRITY_ERROR" | "RECONCILIATION_PENDING",
    message: string,
  ) {
    super(message);
    this.name = "PendingMultipartCancellationError";
  }
}

export async function commitPendingMultipartActivityObservation<T>(
  input: Readonly<{
    createAttemptedAt: Date | null;
    cancellationObservedAt: Date;
  }>,
  persist: (effectiveCreateAttemptedAt: Date) => Promise<T>,
): Promise<T> {
  const observed = await persist(input.createAttemptedAt ?? input.cancellationObservedAt);
  if (input.createAttemptedAt === null) {
    // persist() must resolve only after its transaction commits. Throwing here
    // keeps the request pending without rolling back the durable promotion.
    throw new PendingMultipartCancellationError(
      "RECONCILIATION_PENDING",
      "An unexpected remote multipart upload was retained for later reconciliation",
    );
  }
  return observed;
}

type CancellationScope = Readonly<{
  producerId: string;
  trackVersionId: string;
  trackId: string;
  projectId: string;
  purchaseId: string;
  initiationDigest: string;
  createAttemptedAt: Date | null;
  completeAttemptedAt: Date | null;
  partUrlsExpireAt: Date | null;
  audioDeletedAt: Date;
  cancellationObservedAt: Date;
}> &
  PendingMultipartCancellationIdentity;

type PreparedCancellation =
  | PendingMultipartCancellationResult
  | Readonly<{ kind: "pending"; scope: CancellationScope }>
  | Readonly<{
      kind: "initializing";
      scope: Omit<CancellationScope, "uploadId">;
    }>;

/**
 * Publish (or resume) the exact database cancellation journal before touching
 * multipart storage, then reconcile the corresponding remote upload/object.
 * Supplying no expected identity is the restart path used by ghost cleanup:
 * it may resume only the exact identity already persisted by the server.
 */
export async function cancelPendingMultipartUpload(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Readonly<{
    trackVersionId: string;
    expected?: PendingMultipartCancellationExpectedIdentity;
  }>,
): Promise<PendingMultipartCancellationResult> {
  if (input.expected)
    assertValidExpectedIdentity(ctx.producerId, input.trackVersionId, input.expected);

  const [discovered] = await ctx.db
    .select({
      trackId: trackVersions.trackId,
      purchaseId: trackVersions.purchaseId,
      versionProducerId: trackVersions.producerId,
      projectId: projectTracks.projectId,
      projectProducerId: projects.producerId,
      purchaseProducerId: purchases.producerId,
      purchaseProjectId: purchases.projectId,
    })
    .from(trackVersions)
    .innerJoin(
      projectTracks,
      and(
        eq(projectTracks.id, trackVersions.trackId),
        eq(projectTracks.purchaseId, trackVersions.purchaseId),
      ),
    )
    .innerJoin(
      projects,
      and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, ctx.producerId)),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, ctx.producerId),
      ),
    )
    .where(
      and(eq(trackVersions.id, input.trackVersionId), eq(trackVersions.producerId, ctx.producerId)),
    )
    .limit(1);
  if (
    !discovered ||
    discovered.versionProducerId !== ctx.producerId ||
    discovered.projectProducerId !== ctx.producerId ||
    discovered.purchaseProducerId !== ctx.producerId ||
    discovered.purchaseProjectId !== discovered.projectId
  ) {
    throw new PendingMultipartCancellationError("NOT_FOUND", "Audio upload was not found");
  }

  const prepared = await ctx.db.transaction(async (tx): Promise<PreparedCancellation> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${discovered.projectId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${discovered.purchaseId}, 0))`,
    );
    const [version] = await tx
      .select({
        trackId: trackVersions.trackId,
        purchaseId: trackVersions.purchaseId,
        versionProducerId: trackVersions.producerId,
        projectId: projectTracks.projectId,
        projectProducerId: projects.producerId,
        purchaseProducerId: purchases.producerId,
        purchaseProjectId: purchases.projectId,
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
        sizeBytes: trackVersions.sizeBytes,
        audioObjectEtag: trackVersions.audioObjectEtag,
        audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
        audioDeletedAt: trackVersions.audioDeletedAt,
        pendingAudioR2Key: trackVersions.pendingAudioR2Key,
        pendingAudioUploadId: trackVersions.pendingAudioUploadId,
        pendingAudioInitiationDigest: trackVersions.pendingAudioInitiationDigest,
        pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
        pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
        pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
        pendingAudioCreateAttemptedAt: trackVersions.pendingAudioCreateAttemptedAt,
        pendingAudioCompleteAttemptedAt: trackVersions.pendingAudioCompleteAttemptedAt,
        pendingAudioPartUrlsExpireAt: trackVersions.pendingAudioPartUrlsExpireAt,
        pendingAudioCancelRequestedAt: trackVersions.pendingAudioCancelRequestedAt,
        pendingAudioCleanupEtag: trackVersions.pendingAudioCleanupEtag,
      })
      .from(trackVersions)
      .innerJoin(
        projectTracks,
        and(
          eq(projectTracks.id, trackVersions.trackId),
          eq(projectTracks.purchaseId, trackVersions.purchaseId),
        ),
      )
      .innerJoin(
        projects,
        and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, ctx.producerId)),
      )
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, trackVersions.purchaseId),
          eq(purchases.projectId, projectTracks.projectId),
          eq(purchases.producerId, ctx.producerId),
        ),
      )
      .where(
        and(
          eq(trackVersions.id, input.trackVersionId),
          eq(trackVersions.producerId, ctx.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !version ||
      version.trackId !== discovered.trackId ||
      version.purchaseId !== discovered.purchaseId ||
      version.projectId !== discovered.projectId ||
      version.versionProducerId !== ctx.producerId ||
      version.projectProducerId !== ctx.producerId ||
      version.purchaseProducerId !== ctx.producerId ||
      version.purchaseProjectId !== discovered.projectId
    ) {
      throw new PendingMultipartCancellationError("NOT_FOUND", "Audio upload was not found");
    }

    const audioValues = [
      version.audioUrl,
      version.audioR2Key,
      version.sizeBytes,
      version.audioObjectEtag,
      version.audioIdentityFingerprint,
    ];
    const hasAnyAudio = audioValues.some((value) => value !== null);
    const hasAllAudio = audioValues.every((value) => value !== null);
    const pendingBaseValues = [
      version.pendingAudioR2Key,
      version.pendingAudioInitiationDigest,
      version.pendingAudioCompletionToken,
      version.pendingAudioSizeBytes,
      version.pendingAudioStartedAt,
    ];
    const hasAnyPending = pendingBaseValues.some((value) => value !== null);
    const hasAllPending = pendingBaseValues.every((value) => value !== null);
    if (
      (hasAnyAudio && !hasAllAudio) ||
      (hasAnyPending && !hasAllPending) ||
      (version.pendingAudioUploadId !== null && !hasAllPending) ||
      (version.pendingAudioCreateAttemptedAt !== null && !hasAllPending) ||
      (version.pendingAudioCompleteAttemptedAt !== null && !hasAllPending) ||
      (version.pendingAudioPartUrlsExpireAt !== null && !hasAllPending) ||
      (version.pendingAudioUploadId !== null && version.pendingAudioCreateAttemptedAt === null) ||
      (version.pendingAudioPartUrlsExpireAt !== null && version.pendingAudioUploadId === null) ||
      (version.pendingAudioCompleteAttemptedAt !== null &&
        (version.pendingAudioUploadId === null || version.pendingAudioPartUrlsExpireAt === null)) ||
      (hasAnyAudio && hasAnyPending) ||
      (version.pendingAudioCancelRequestedAt !== null && !hasAllPending) ||
      (version.pendingAudioCleanupEtag !== null &&
        (!hasAllPending || version.pendingAudioCompleteAttemptedAt === null)) ||
      (version.audioDeletedAt !== null && hasAnyAudio) ||
      (version.audioDeletedAt !== null &&
        hasAnyPending &&
        version.pendingAudioCancelRequestedAt === null) ||
      (hasAnyPending &&
        version.pendingAudioCancelRequestedAt !== null &&
        version.audioDeletedAt === null)
    ) {
      throw new PendingMultipartCancellationError(
        "INTEGRITY_ERROR",
        "Audio upload recovery state is inconsistent",
      );
    }
    if (hasAllAudio) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The audio upload is already attached and cannot be canceled",
      );
    }
    if (version.audioDeletedAt !== null && !hasAnyPending) {
      return { kind: "already_deleted", projectId: discovered.projectId };
    }

    const cancellationRequestedAt = new Date();
    if (!hasAnyPending) {
      if (input.expected) {
        throw new PendingMultipartCancellationError(
          "CONFLICT",
          "No server-issued multipart identity is pending for this version",
        );
      }
      return { kind: "no_pending", projectId: discovered.projectId };
    }

    const pendingIdentity = readPendingBaseIdentity(version);
    if (
      input.expected &&
      (version.pendingAudioUploadId === null ||
        !expectedIdentityMatches(input.expected, {
          ...pendingIdentity,
          uploadId: version.pendingAudioUploadId,
        }))
    ) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "A different upload is already pending for this version",
      );
    }
    if (
      !isAudioKeyForTrackVersion(pendingIdentity.key, {
        producerId: ctx.producerId,
        trackVersionId: input.trackVersionId,
      })
    ) {
      throw new PendingMultipartCancellationError(
        "INTEGRITY_ERROR",
        "The pending audio key is outside the owned version namespace",
      );
    }
    if (version.pendingAudioCancelRequestedAt === null) {
      const [requested] = await tx
        .update(trackVersions)
        .set({
          pendingAudioCancelRequestedAt: cancellationRequestedAt,
          audioDeletedAt: cancellationRequestedAt,
        })
        .where(
          and(
            eq(trackVersions.id, input.trackVersionId),
            eq(trackVersions.producerId, ctx.producerId),
            eq(trackVersions.trackId, discovered.trackId),
            eq(trackVersions.purchaseId, discovered.purchaseId),
            eq(trackVersions.pendingAudioR2Key, pendingIdentity.key),
            version.pendingAudioUploadId === null
              ? isNull(trackVersions.pendingAudioUploadId)
              : eq(trackVersions.pendingAudioUploadId, version.pendingAudioUploadId),
            eq(trackVersions.pendingAudioCompletionToken, pendingIdentity.completionToken),
            eq(trackVersions.pendingAudioSizeBytes, pendingIdentity.sizeBytes),
            eq(trackVersions.pendingAudioInitiationDigest, pendingIdentity.initiationDigest),
            isNotNull(trackVersions.pendingAudioStartedAt),
            isNull(trackVersions.audioDeletedAt),
            version.pendingAudioCompleteAttemptedAt === null
              ? isNull(trackVersions.pendingAudioCompleteAttemptedAt)
              : eq(
                  trackVersions.pendingAudioCompleteAttemptedAt,
                  version.pendingAudioCompleteAttemptedAt,
                ),
            version.pendingAudioPartUrlsExpireAt === null
              ? isNull(trackVersions.pendingAudioPartUrlsExpireAt)
              : eq(
                  trackVersions.pendingAudioPartUrlsExpireAt,
                  version.pendingAudioPartUrlsExpireAt,
                ),
            isNull(trackVersions.pendingAudioCancelRequestedAt),
          ),
        )
        .returning({ id: trackVersions.id });
      if (!requested) {
        throw new PendingMultipartCancellationError(
          "CONFLICT",
          "The upload changed before cancellation was saved",
        );
      }
    }
    const cancellationObservedAt = version.pendingAudioCancelRequestedAt ?? cancellationRequestedAt;
    const audioDeletedAt = version.audioDeletedAt ?? cancellationRequestedAt;
    if (version.pendingAudioUploadId === null) {
      return {
        kind: "initializing",
        scope: {
          producerId: ctx.producerId,
          trackVersionId: input.trackVersionId,
          trackId: discovered.trackId,
          projectId: discovered.projectId,
          purchaseId: discovered.purchaseId,
          completeAttemptedAt: version.pendingAudioCompleteAttemptedAt,
          partUrlsExpireAt: version.pendingAudioPartUrlsExpireAt,
          audioDeletedAt,
          cancellationObservedAt,
          ...pendingIdentity,
          objectEtag: version.pendingAudioCleanupEtag,
        },
      };
    }
    return {
      kind: "pending",
      scope: {
        producerId: ctx.producerId,
        trackVersionId: input.trackVersionId,
        trackId: discovered.trackId,
        projectId: discovered.projectId,
        purchaseId: discovered.purchaseId,
        completeAttemptedAt: version.pendingAudioCompleteAttemptedAt,
        partUrlsExpireAt: version.pendingAudioPartUrlsExpireAt,
        audioDeletedAt,
        cancellationObservedAt,
        ...pendingIdentity,
        uploadId: version.pendingAudioUploadId,
        objectEtag: version.pendingAudioCleanupEtag,
      },
    };
  });

  if (prepared.kind === "initializing") {
    const reconciled = await finishInitializingAudioCancellation(ctx, prepared.scope);
    if (!reconciled) {
      throw new PendingMultipartCancellationError(
        "RECONCILIATION_PENDING",
        "The canceled upload is still being safely reconciled",
      );
    }
    return { kind: "canceled", projectId: prepared.scope.projectId };
  }
  if (prepared.kind !== "pending") return prepared;
  const reconciled = await finishPendingAudioCancellation(ctx, prepared.scope);
  if (!reconciled) {
    throw new PendingMultipartCancellationError(
      "RECONCILIATION_PENDING",
      "The canceled upload is still being safely reconciled",
    );
  }
  return { kind: "canceled", projectId: prepared.scope.projectId };
}

function readPendingBaseIdentity(
  version: Readonly<{
    pendingAudioR2Key: string | null;
    pendingAudioInitiationDigest: string | null;
    pendingAudioCompletionToken: string | null;
    pendingAudioSizeBytes: number | null;
    pendingAudioStartedAt: Date | null;
    pendingAudioCreateAttemptedAt: Date | null;
    pendingAudioCompleteAttemptedAt: Date | null;
    pendingAudioPartUrlsExpireAt: Date | null;
    pendingAudioCancelRequestedAt: Date | null;
  }>,
): Omit<PendingMultipartCancellationExpectedIdentity, "uploadId"> &
  Readonly<{ initiationDigest: string; createAttemptedAt: Date | null }> {
  const key = version.pendingAudioR2Key;
  const initiationDigest = version.pendingAudioInitiationDigest;
  const completionToken = version.pendingAudioCompletionToken;
  const sizeBytes = version.pendingAudioSizeBytes;
  const startedAt = version.pendingAudioStartedAt;
  const createAttemptedAt = version.pendingAudioCreateAttemptedAt;
  const completeAttemptedAt = version.pendingAudioCompleteAttemptedAt;
  const partUrlsExpireAt = version.pendingAudioPartUrlsExpireAt;
  if (
    typeof key !== "string" ||
    typeof initiationDigest !== "string" ||
    typeof completionToken !== "string" ||
    typeof sizeBytes !== "number" ||
    !(startedAt instanceof Date) ||
    !Number.isFinite(startedAt.getTime()) ||
    !/^sha256:[0-9a-f]{64}$/.test(initiationDigest) ||
    !/^[0-9a-f]{64}$/.test(completionToken) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    (createAttemptedAt !== null &&
      (!(createAttemptedAt instanceof Date) ||
        !Number.isFinite(createAttemptedAt.getTime()) ||
        createAttemptedAt < startedAt)) ||
    (partUrlsExpireAt !== null &&
      (!(partUrlsExpireAt instanceof Date) ||
        !Number.isFinite(partUrlsExpireAt.getTime()) ||
        createAttemptedAt === null ||
        partUrlsExpireAt < createAttemptedAt)) ||
    (completeAttemptedAt !== null &&
      (!(completeAttemptedAt instanceof Date) ||
        !Number.isFinite(completeAttemptedAt.getTime()) ||
        createAttemptedAt === null ||
        partUrlsExpireAt === null ||
        completeAttemptedAt < createAttemptedAt)) ||
    (version.pendingAudioCancelRequestedAt !== null &&
      completeAttemptedAt !== null &&
      version.pendingAudioCancelRequestedAt < completeAttemptedAt)
  ) {
    throw new PendingMultipartCancellationError(
      "INTEGRITY_ERROR",
      "The pending upload identity is incomplete",
    );
  }
  return { key, initiationDigest, completionToken, sizeBytes, createAttemptedAt };
}

function assertValidExpectedIdentity(
  producerId: string,
  trackVersionId: string,
  expected: PendingMultipartCancellationExpectedIdentity,
): void {
  if (
    expected.uploadId.trim().length === 0 ||
    !/^[0-9a-f]{64}$/.test(expected.completionToken) ||
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes <= 0 ||
    !isAudioKeyForTrackVersion(expected.key, { producerId, trackVersionId })
  ) {
    throw new PendingMultipartCancellationError(
      "CONFLICT",
      "The upload cancellation identity is invalid",
    );
  }
}

function expectedIdentityMatches(
  expected: PendingMultipartCancellationExpectedIdentity,
  persisted: PendingMultipartCancellationExpectedIdentity,
): boolean {
  return (
    expected.key === persisted.key &&
    expected.uploadId === persisted.uploadId &&
    expected.sizeBytes === persisted.sizeBytes &&
    expected.completionToken === persisted.completionToken
  );
}

function pendingObjectIdentityMatches(
  input: Readonly<{
    expectedEtag: string | null;
    expectedSizeBytes: number;
    expectedCompletionToken: string;
    observedEtag: string | undefined;
    observedSizeBytes: number | undefined;
    observedCompletionToken: string | undefined;
  }>,
): boolean {
  const observedEtag = input.observedEtag?.trim();
  return (
    typeof observedEtag === "string" &&
    observedEtag.length > 0 &&
    (input.expectedEtag === null || observedEtag === input.expectedEtag.trim()) &&
    input.observedSizeBytes === input.expectedSizeBytes &&
    input.expectedCompletionToken.length === 64 &&
    input.observedCompletionToken === input.expectedCompletionToken
  );
}

async function finishInitializingAudioCancellation(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Omit<CancellationScope, "uploadId">,
): Promise<boolean> {
  const uploadIds = await listExactMultipartUploadIds(input.key);
  if (uploadIds.length > 0) {
    await refreshCancellationObservation(ctx, input, input.objectEtag);
  }
  for (const uploadId of uploadIds) {
    if (!(await abortMultipartUploadAndObserve(input.key, uploadId)).absent) return false;
  }
  const uploadsAfterAbort = await listExactMultipartUploadIds(input.key);
  if (uploadsAfterAbort.length !== 0) {
    await refreshCancellationObservation(ctx, input, input.objectEtag);
    return false;
  }

  let observed: Readonly<{
    eTag: string | undefined;
    sizeBytes: number | undefined;
    completionToken: string | undefined;
  }> | null = null;
  if (!(await exactObjectIsAbsent(input.key))) {
    const head = await getR2().send(
      new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: input.key }),
    );
    observed = {
      eTag: head.ETag,
      sizeBytes: head.ContentLength,
      completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
    };
  }

  if (observed !== null) {
    // An object without a durable CompleteMultipart boundary cannot be
    // proven to belong to this initiation. Keep the tombstone and stop.
    return false;
  }

  const eraseRecoveryIdentity = canFinalizePendingMultipartCancellation({
    cancellationObservedAt: input.cancellationObservedAt,
    createAttemptedAt: input.createAttemptedAt,
    completeAttemptedAt: input.completeAttemptedAt,
    partUrlsExpireAt: input.partUrlsExpireAt,
    observedRemoteActivity: uploadIds.length > 0,
    verifiedRemoteAbsence: false,
    now: new Date(),
  });

  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`);
    const [cleared] = await tx
      .update(trackVersions)
      .set(
        eraseRecoveryIdentity
          ? {
              pendingAudioR2Key: null,
              pendingAudioUploadId: null,
              pendingAudioInitiationDigest: null,
              pendingAudioCompletionToken: null,
              pendingAudioSizeBytes: null,
              pendingAudioStartedAt: null,
              pendingAudioCreateAttemptedAt: null,
              pendingAudioCompleteAttemptedAt: null,
              pendingAudioPartUrlsExpireAt: null,
              pendingAudioCancelRequestedAt: null,
              pendingAudioCleanupEtag: null,
              audioDeletedAt: input.audioDeletedAt,
            }
          : { audioDeletedAt: input.audioDeletedAt },
      )
      .where(
        and(
          eq(trackVersions.id, input.trackVersionId),
          eq(trackVersions.producerId, input.producerId),
          eq(trackVersions.trackId, input.trackId),
          eq(trackVersions.purchaseId, input.purchaseId),
          eq(trackVersions.audioDeletedAt, input.audioDeletedAt),
          isNull(trackVersions.audioUrl),
          isNull(trackVersions.audioR2Key),
          isNull(trackVersions.sizeBytes),
          isNull(trackVersions.audioObjectEtag),
          isNull(trackVersions.audioIdentityFingerprint),
          eq(trackVersions.pendingAudioR2Key, input.key),
          isNull(trackVersions.pendingAudioUploadId),
          eq(trackVersions.pendingAudioInitiationDigest, input.initiationDigest),
          eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
          eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
          isNotNull(trackVersions.pendingAudioStartedAt),
          input.createAttemptedAt === null
            ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
            : eq(trackVersions.pendingAudioCreateAttemptedAt, input.createAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteAttemptedAt),
          isNull(trackVersions.pendingAudioPartUrlsExpireAt),
          eq(trackVersions.pendingAudioCancelRequestedAt, input.cancellationObservedAt),
          input.objectEtag === null
            ? isNull(trackVersions.pendingAudioCleanupEtag)
            : eq(trackVersions.pendingAudioCleanupEtag, input.objectEtag),
        ),
      )
      .returning({ id: trackVersions.id });
    if (!cleared) return false;
    await tx
      .update(projects)
      .set({ updatedAt: sql`GREATEST(${projects.updatedAt}, ${input.audioDeletedAt})` })
      .where(and(eq(projects.id, input.projectId), eq(projects.producerId, input.producerId)));
    return eraseRecoveryIdentity;
  });
}

async function refreshCancellationObservation(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Readonly<{
    trackVersionId: string;
    trackId: string;
    projectId: string;
    purchaseId: string;
    key: string;
    initiationDigest: string;
    completionToken: string;
    sizeBytes: number;
    createAttemptedAt: Date | null;
    completeAttemptedAt: Date | null;
    partUrlsExpireAt: Date | null;
    audioDeletedAt: Date;
    cancellationObservedAt: Date;
  }>,
  cleanupEtag: string | null,
): Promise<Date> {
  return commitPendingMultipartActivityObservation(input, (effectiveCreateAttemptedAt) =>
    ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`);
      const [refreshed] = await tx
        .update(trackVersions)
        .set({
          pendingAudioCancelRequestedAt: input.cancellationObservedAt,
          pendingAudioCreateAttemptedAt: effectiveCreateAttemptedAt,
        })
        .where(
          and(
            eq(trackVersions.id, input.trackVersionId),
            eq(trackVersions.producerId, ctx.producerId),
            eq(trackVersions.trackId, input.trackId),
            eq(trackVersions.purchaseId, input.purchaseId),
            eq(trackVersions.pendingAudioR2Key, input.key),
            eq(trackVersions.pendingAudioInitiationDigest, input.initiationDigest),
            eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
            eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
            isNotNull(trackVersions.pendingAudioStartedAt),
            input.createAttemptedAt === null
              ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
              : eq(trackVersions.pendingAudioCreateAttemptedAt, input.createAttemptedAt),
            input.completeAttemptedAt === null
              ? isNull(trackVersions.pendingAudioCompleteAttemptedAt)
              : eq(trackVersions.pendingAudioCompleteAttemptedAt, input.completeAttemptedAt),
            input.partUrlsExpireAt === null
              ? isNull(trackVersions.pendingAudioPartUrlsExpireAt)
              : eq(trackVersions.pendingAudioPartUrlsExpireAt, input.partUrlsExpireAt),
            eq(trackVersions.pendingAudioCancelRequestedAt, input.cancellationObservedAt),
            eq(trackVersions.audioDeletedAt, input.audioDeletedAt),
            cleanupEtag === null
              ? isNull(trackVersions.pendingAudioCleanupEtag)
              : eq(trackVersions.pendingAudioCleanupEtag, cleanupEtag),
          ),
        )
        .returning({ id: trackVersions.id });
      if (!refreshed) {
        throw new PendingMultipartCancellationError(
          "RECONCILIATION_PENDING",
          "The cancellation journal changed during storage reconciliation",
        );
      }
      return input.cancellationObservedAt;
    }),
  );
}

async function finishPendingAudioCancellation(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: CancellationScope,
): Promise<boolean> {
  let observedRemoteActivity = false;
  return reconcilePendingMultipartCancellation(input, {
    async abortExact(exact) {
      const initiallyObservedUploadIds = await listExactMultipartUploadIds(exact.key);
      if (initiallyObservedUploadIds.length > 0) {
        observedRemoteActivity = true;
        await refreshCancellationObservation(ctx, input, input.objectEtag);
      }
      const exactAbort = await abortMultipartUploadAndObserve(exact.key, exact.uploadId);
      if (exactAbort.observedRemoteActivity && !observedRemoteActivity) {
        observedRemoteActivity = true;
        await refreshCancellationObservation(ctx, input, input.objectEtag);
      }
      if (!exactAbort.absent) {
        throw new PendingMultipartCancellationError(
          "RECONCILIATION_PENDING",
          "Multipart parts are still being reconciled",
        );
      }
      const remainingUploadIds = await listExactMultipartUploadIds(exact.key);
      if (remainingUploadIds.length > 0) {
        observedRemoteActivity = true;
        await refreshCancellationObservation(ctx, input, input.objectEtag);
      }
      for (const uploadId of remainingUploadIds) {
        const remainingAbort = await abortMultipartUploadAndObserve(exact.key, uploadId);
        if (!remainingAbort.absent) {
          throw new PendingMultipartCancellationError(
            "RECONCILIATION_PENDING",
            "Multipart parts are still being reconciled",
          );
        }
      }
      const uploadsAfterAbort = await listExactMultipartUploadIds(exact.key);
      if (uploadsAfterAbort.length !== 0) {
        observedRemoteActivity = true;
        await refreshCancellationObservation(ctx, input, input.objectEtag);
        throw new PendingMultipartCancellationError(
          "RECONCILIATION_PENDING",
          "Multipart uploads are still being reconciled",
        );
      }
    },
    async head(key) {
      if (await exactObjectIsAbsent(key)) return null;
      observedRemoteActivity = true;
      await refreshCancellationObservation(ctx, input, input.objectEtag);
      const head = await getR2().send(new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
      return {
        eTag: head.ETag,
        sizeBytes: head.ContentLength,
        completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
      };
    },
    async publishDeleteIntent(exact) {
      if (input.completeAttemptedAt === null) return false;
      const completeAttemptedAt = input.completeAttemptedAt;
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`,
        );
        const [existingReference] = await tx
          .select({ id: trackVersions.id })
          .from(trackVersions)
          .where(eq(trackVersions.audioR2Key, input.key))
          .limit(1)
          .for("update");
        if (existingReference) return false;
        const [published] = await tx
          .update(trackVersions)
          .set({ pendingAudioCleanupEtag: exact.objectEtag })
          .where(
            and(
              eq(trackVersions.id, input.trackVersionId),
              eq(trackVersions.producerId, input.producerId),
              eq(trackVersions.trackId, input.trackId),
              eq(trackVersions.purchaseId, input.purchaseId),
              isNull(trackVersions.audioUrl),
              isNull(trackVersions.audioR2Key),
              isNull(trackVersions.sizeBytes),
              isNull(trackVersions.audioObjectEtag),
              isNull(trackVersions.audioIdentityFingerprint),
              eq(trackVersions.audioDeletedAt, input.audioDeletedAt),
              eq(trackVersions.pendingAudioR2Key, input.key),
              eq(trackVersions.pendingAudioUploadId, input.uploadId),
              eq(trackVersions.pendingAudioInitiationDigest, input.initiationDigest),
              eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
              eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
              isNotNull(trackVersions.pendingAudioStartedAt),
              input.createAttemptedAt === null
                ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
                : eq(trackVersions.pendingAudioCreateAttemptedAt, input.createAttemptedAt),
              eq(trackVersions.pendingAudioCompleteAttemptedAt, completeAttemptedAt),
              input.partUrlsExpireAt === null
                ? isNull(trackVersions.pendingAudioPartUrlsExpireAt)
                : eq(trackVersions.pendingAudioPartUrlsExpireAt, input.partUrlsExpireAt),
              eq(trackVersions.pendingAudioCancelRequestedAt, input.cancellationObservedAt),
              isNull(trackVersions.pendingAudioCleanupEtag),
            ),
          )
          .returning({ id: trackVersions.id });
        return published !== undefined;
      });
    },
    async deleteExact({ key, ifMatch }) {
      await getR2().send(
        new DeleteObjectCommand({ Bucket: BUCKETS.audio, Key: key, IfMatch: ifMatch }),
      );
    },
    async clearExact(exact) {
      return ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`,
        );
        const eraseRecoveryIdentity = canFinalizePendingMultipartCancellation({
          cancellationObservedAt: input.cancellationObservedAt,
          createAttemptedAt: input.createAttemptedAt,
          completeAttemptedAt: input.completeAttemptedAt,
          partUrlsExpireAt: input.partUrlsExpireAt,
          observedRemoteActivity,
          verifiedRemoteAbsence: true,
          now: new Date(),
        });
        const [cleared] = await tx
          .update(trackVersions)
          .set(
            eraseRecoveryIdentity
              ? {
                  pendingAudioR2Key: null,
                  pendingAudioUploadId: null,
                  pendingAudioInitiationDigest: null,
                  pendingAudioCompletionToken: null,
                  pendingAudioSizeBytes: null,
                  pendingAudioStartedAt: null,
                  pendingAudioCreateAttemptedAt: null,
                  pendingAudioCompleteAttemptedAt: null,
                  pendingAudioPartUrlsExpireAt: null,
                  pendingAudioCancelRequestedAt: null,
                  pendingAudioCleanupEtag: null,
                  audioDeletedAt: input.audioDeletedAt,
                }
              : { audioDeletedAt: input.audioDeletedAt },
          )
          .where(
            and(
              eq(trackVersions.id, input.trackVersionId),
              eq(trackVersions.producerId, input.producerId),
              eq(trackVersions.trackId, input.trackId),
              eq(trackVersions.purchaseId, input.purchaseId),
              eq(trackVersions.audioDeletedAt, input.audioDeletedAt),
              isNull(trackVersions.audioUrl),
              isNull(trackVersions.audioR2Key),
              isNull(trackVersions.sizeBytes),
              isNull(trackVersions.audioObjectEtag),
              isNull(trackVersions.audioIdentityFingerprint),
              eq(trackVersions.pendingAudioR2Key, input.key),
              eq(trackVersions.pendingAudioUploadId, input.uploadId),
              eq(trackVersions.pendingAudioInitiationDigest, input.initiationDigest),
              eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
              eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
              isNotNull(trackVersions.pendingAudioStartedAt),
              input.createAttemptedAt === null
                ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
                : eq(trackVersions.pendingAudioCreateAttemptedAt, input.createAttemptedAt),
              input.completeAttemptedAt === null
                ? isNull(trackVersions.pendingAudioCompleteAttemptedAt)
                : eq(trackVersions.pendingAudioCompleteAttemptedAt, input.completeAttemptedAt),
              input.partUrlsExpireAt === null
                ? isNull(trackVersions.pendingAudioPartUrlsExpireAt)
                : eq(trackVersions.pendingAudioPartUrlsExpireAt, input.partUrlsExpireAt),
              eq(trackVersions.pendingAudioCancelRequestedAt, input.cancellationObservedAt),
              exact.objectEtag === null
                ? isNull(trackVersions.pendingAudioCleanupEtag)
                : eq(trackVersions.pendingAudioCleanupEtag, exact.objectEtag),
            ),
          )
          .returning({ id: trackVersions.id });
        if (!cleared) return false;
        await tx
          .update(projects)
          .set({ updatedAt: sql`GREATEST(${projects.updatedAt}, ${input.audioDeletedAt})` })
          .where(and(eq(projects.id, input.projectId), eq(projects.producerId, input.producerId)));
        return eraseRecoveryIdentity;
      });
    },
  });
}
