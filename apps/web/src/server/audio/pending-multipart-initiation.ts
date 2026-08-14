import { createHash, randomBytes } from "node:crypto";
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import {
  and,
  eq,
  isNull,
  projectTracks,
  projects,
  purchases,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { expectedAudioMultipartPartSize } from "~/lib/audio/storage-limits";
import {
  listExactMultipartUploadIds,
  MULTIPART_CREATE_UNCERTAINTY_MS,
} from "~/server/audio/multipart-storage-recovery";
import { PendingMultipartCancellationError } from "~/server/audio/pending-multipart-cancellation";
import {
  assertProducerAudioStorageAvailable,
  lockProducerAudioStorageQuota,
} from "~/server/domain/audio-storage/quota";
import {
  lockProducerCapabilityState,
  type LockedProducerCapabilityState,
} from "~/server/domain/producer-capabilities/open-state";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
} from "~/server/domain/version-uploads/service";
import { currentTrackArtistApprovalAction } from "~/server/domain/version-uploads/db";
import {
  BUCKETS,
  buildAudioKey,
  getR2SingleAttempt,
  isAudioKeyForTrackVersion,
} from "~/server/storage/r2";

const AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA = "skitza-upload-token";

function requireMultipartProducerOpen(producer: LockedProducerCapabilityState | null): void {
  if (!producer || producer.closedAt !== null) {
    throw new VersionUploadDomainError("INACTIVE", "This studio is closed");
  }
}

type PendingInitiation = Readonly<{
  projectId: string;
  purchaseId: string;
  trackId: string;
  key: string;
  uploadId: string | null;
  initiationDigest: string;
  completionToken: string;
  sizeBytes: number;
  createAttemptedAt: Date | null;
}>;

export type PendingMultipartInitiationResult = Readonly<{
  key: string;
  uploadId: string;
  completionToken: string;
}>;

export function createPendingAudioInitiationDigest(
  input: Readonly<{
    filename: string;
    contentType: string;
    sizeBytes: number;
  }>,
): string {
  const encode = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonical = [
    "skitza-pending-audio-initiation-v1",
    encode(input.filename),
    encode(input.contentType),
    encode(input.sizeBytes.toString()),
  ].join("|");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function decideMultipartCreateRecovery(
  input: Readonly<{
    observedUploadIds: readonly string[];
    createAttemptedAt: Date | null;
    now: Date;
  }>,
):
  | Readonly<{ kind: "bind"; uploadId: string }>
  | Readonly<{ kind: "create" }>
  | Readonly<{ kind: "wait" }>
  | Readonly<{ kind: "abandon" }>
  | Readonly<{ kind: "conflict" }> {
  if (input.observedUploadIds.length > 1) return { kind: "conflict" };
  const observed = input.observedUploadIds[0];
  if (observed) return { kind: "bind", uploadId: observed };
  if (input.createAttemptedAt === null) return { kind: "create" };
  const attemptedAt = input.createAttemptedAt.getTime();
  const now = input.now.getTime();
  if (!Number.isFinite(attemptedAt) || !Number.isFinite(now) || attemptedAt > now) {
    return { kind: "conflict" };
  }
  return now - attemptedAt >= MULTIPART_CREATE_UNCERTAINTY_MS
    ? { kind: "abandon" }
    : { kind: "wait" };
}

/**
 * Journal a server-created upload identity before it is returned to the
 * browser. The first transaction publishes a durable creation intent. The
 * second holds the project/purchase lock while it discovers or creates the R2
 * upload and binds the server-observed UploadId. A crash in between is resumed
 * from the exact persisted key on the next call.
 */
export async function createOrResumePendingMultipartUpload(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Readonly<{
    trackVersionId: string;
    filename: string;
    sizeBytes: number;
    contentType: string;
  }>,
): Promise<PendingMultipartInitiationResult> {
  const proposedKey = buildAudioKey({
    producerId: ctx.producerId,
    trackVersionId: input.trackVersionId,
    filename: input.filename,
  });
  const proposedCompletionToken = randomBytes(32).toString("hex");
  const proposedInitiationDigest = createPendingAudioInitiationDigest(input);
  const discovered = await discoverOwnedVersion(ctx, input.trackVersionId);

  const staged = await ctx.db.transaction(async (tx): Promise<PendingInitiation> => {
    await lockProducerAudioStorageQuota(tx, ctx.producerId);
    requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
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
        trackArchivedAt: projectTracks.archivedAt,
        projectProducerId: projects.producerId,
        projectLifecycleStatus: projects.lifecycleStatus,
        purchaseProducerId: purchases.producerId,
        purchaseProjectId: purchases.projectId,
        purchaseLifecycleStatus: purchases.lifecycleStatus,
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
        attachedSizeBytes: trackVersions.sizeBytes,
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
        pendingAudioCompleteWriteOnceProtectedAt:
          trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
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
    const approvalAction = await currentTrackArtistApprovalAction(tx, {
      trackId: discovered.trackId,
      purchaseId: discovered.purchaseId,
      producerId: ctx.producerId,
    });
    assertOwnedActiveVersion(ctx.producerId, discovered, version, approvalAction);
    assertUnattachedVersion(version);

    const pending = readPendingInitiation(version);
    if (pending) {
      if (
        pending.sizeBytes !== input.sizeBytes ||
        pending.initiationDigest !== proposedInitiationDigest ||
        !isAudioKeyForTrackVersion(pending.key, {
          producerId: ctx.producerId,
          trackVersionId: input.trackVersionId,
        }) ||
        version.pendingAudioCancelRequestedAt !== null ||
        version.pendingAudioCompleteAttemptedAt !== null ||
        version.pendingAudioCompleteWriteOnceProtectedAt !== null ||
        version.pendingAudioCleanupEtag !== null
      ) {
        throw new PendingMultipartCancellationError(
          "CONFLICT",
          "A different upload is already pending for this version",
        );
      }
      return {
        projectId: discovered.projectId,
        purchaseId: discovered.purchaseId,
        trackId: discovered.trackId,
        ...pending,
      };
    }

    await assertProducerAudioStorageAvailable(tx, ctx.producerId, input.sizeBytes);

    const startedAt = new Date();
    const [journaled] = await tx
      .update(trackVersions)
      .set({
        pendingAudioR2Key: proposedKey,
        pendingAudioUploadId: null,
        pendingAudioInitiationDigest: proposedInitiationDigest,
        pendingAudioCompletionToken: proposedCompletionToken,
        pendingAudioSizeBytes: input.sizeBytes,
        pendingAudioStartedAt: startedAt,
        pendingAudioCreateAttemptedAt: null,
        pendingAudioCompleteAttemptedAt: null,
        pendingAudioCompleteWriteOnceProtectedAt: null,
        pendingAudioPartUrlsExpireAt: null,
        pendingAudioCancelRequestedAt: null,
        pendingAudioCleanupEtag: null,
      })
      .where(
        and(
          eq(trackVersions.id, input.trackVersionId),
          eq(trackVersions.producerId, ctx.producerId),
          eq(trackVersions.trackId, discovered.trackId),
          eq(trackVersions.purchaseId, discovered.purchaseId),
          isNull(trackVersions.audioDeletedAt),
          isNull(trackVersions.audioUrl),
          isNull(trackVersions.audioR2Key),
          isNull(trackVersions.sizeBytes),
          isNull(trackVersions.audioObjectEtag),
          isNull(trackVersions.audioIdentityFingerprint),
          isNull(trackVersions.pendingAudioR2Key),
          isNull(trackVersions.pendingAudioUploadId),
          isNull(trackVersions.pendingAudioInitiationDigest),
          isNull(trackVersions.pendingAudioCompletionToken),
          isNull(trackVersions.pendingAudioSizeBytes),
          isNull(trackVersions.pendingAudioStartedAt),
          isNull(trackVersions.pendingAudioCreateAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt),
          isNull(trackVersions.pendingAudioPartUrlsExpireAt),
          isNull(trackVersions.pendingAudioCancelRequestedAt),
          isNull(trackVersions.pendingAudioCleanupEtag),
        ),
      )
      .returning({ id: trackVersions.id });
    if (!journaled) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The upload changed before initiation was saved",
      );
    }
    return {
      projectId: discovered.projectId,
      purchaseId: discovered.purchaseId,
      trackId: discovered.trackId,
      key: proposedKey,
      uploadId: null,
      initiationDigest: proposedInitiationDigest,
      completionToken: proposedCompletionToken,
      sizeBytes: input.sizeBytes,
      createAttemptedAt: null,
    };
  });

  const prepared = await reconcilePendingInitiation(ctx, input, discovered, staged, undefined);
  if (prepared.kind === "bound") return prepared.result;

  const created = await ctx.db.transaction(async (tx) => {
    requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
    return getR2SingleAttempt().send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKETS.audio,
        Key: staged.key,
        ContentType: input.contentType,
        // Audio can be permanently deleted later. Prevent a custom-domain CDN
        // from retaining playable bytes after the authoritative R2 object is gone.
        CacheControl: "no-store",
        Metadata: { [AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA]: staged.completionToken },
      }),
    );
  });
  const createdUploadId = created.UploadId;
  if (typeof createdUploadId !== "string" || createdUploadId.trim().length === 0) {
    throw new PendingMultipartCancellationError(
      "RECONCILIATION_PENDING",
      "Storage did not return a valid multipart upload identity",
    );
  }

  const reconciled = await reconcilePendingInitiation(
    ctx,
    input,
    discovered,
    { ...staged, createAttemptedAt: prepared.createAttemptedAt },
    createdUploadId,
  );
  if (reconciled.kind !== "bound") {
    throw new PendingMultipartCancellationError(
      "RECONCILIATION_PENDING",
      "The server-created multipart upload is still being discovered",
    );
  }
  return reconciled.result;
}

type PendingInitiationReconciliation =
  | Readonly<{ kind: "bound"; result: PendingMultipartInitiationResult }>
  | Readonly<{ kind: "create"; createAttemptedAt: Date }>;

async function reconcilePendingInitiation(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Readonly<{
    trackVersionId: string;
    filename: string;
    sizeBytes: number;
    contentType: string;
  }>,
  discovered: Readonly<{ projectId: string; purchaseId: string; trackId: string }>,
  staged: PendingInitiation,
  expectedCreatedUploadId: string | undefined,
): Promise<PendingInitiationReconciliation> {
  return ctx.db.transaction(async (tx): Promise<PendingInitiationReconciliation> => {
    requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${staged.projectId}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${staged.purchaseId}, 0))`);
    const [version] = await tx
      .select({
        trackId: trackVersions.trackId,
        purchaseId: trackVersions.purchaseId,
        versionProducerId: trackVersions.producerId,
        projectId: projectTracks.projectId,
        trackArchivedAt: projectTracks.archivedAt,
        projectProducerId: projects.producerId,
        projectLifecycleStatus: projects.lifecycleStatus,
        purchaseProducerId: purchases.producerId,
        purchaseProjectId: purchases.projectId,
        purchaseLifecycleStatus: purchases.lifecycleStatus,
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
        attachedSizeBytes: trackVersions.sizeBytes,
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
        pendingAudioCompleteWriteOnceProtectedAt:
          trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
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
    const approvalAction = await currentTrackArtistApprovalAction(tx, {
      trackId: discovered.trackId,
      purchaseId: discovered.purchaseId,
      producerId: ctx.producerId,
    });
    assertOwnedActiveVersion(ctx.producerId, discovered, version, approvalAction);
    assertUnattachedVersion(version);
    const pending = readPendingInitiation(version);
    if (
      !pending ||
      pending.key !== staged.key ||
      pending.initiationDigest !== staged.initiationDigest ||
      pending.completionToken !== staged.completionToken ||
      pending.sizeBytes !== staged.sizeBytes ||
      version.pendingAudioCompleteAttemptedAt !== null ||
      version.pendingAudioCompleteWriteOnceProtectedAt !== null ||
      version.pendingAudioPartUrlsExpireAt !== null ||
      version.pendingAudioCancelRequestedAt !== null ||
      version.pendingAudioCleanupEtag !== null
    ) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The upload changed before its server identity was bound",
      );
    }
    if (pending.uploadId) {
      return {
        kind: "bound",
        result: {
          key: pending.key,
          uploadId: pending.uploadId,
          completionToken: pending.completionToken,
        },
      };
    }

    const now = new Date();
    // A successful CreateMultipartUpload response is authoritative. Only a
    // retry that lost that response needs to discover the upload by listing.
    const decision =
      expectedCreatedUploadId !== undefined
        ? { kind: "bind" as const, uploadId: expectedCreatedUploadId }
        : decideMultipartCreateRecovery({
            observedUploadIds: await listExactMultipartUploadIds(pending.key),
            createAttemptedAt: pending.createAttemptedAt,
            now,
          });
    if (decision.kind === "conflict") {
      throw new PendingMultipartCancellationError(
        "INTEGRITY_ERROR",
        "More than one multipart upload exists for the pending key",
      );
    }
    if (decision.kind === "wait") {
      throw new PendingMultipartCancellationError(
        "RECONCILIATION_PENDING",
        "A recent multipart create is still being safely reconciled",
      );
    }
    if (decision.kind === "abandon") {
      throw new PendingMultipartCancellationError(
        "RECONCILIATION_PENDING",
        "The earlier multipart create stayed ambiguous and must be canceled before retrying",
      );
    }
    if (decision.kind === "create") {
      const [attempted] = await tx
        .update(trackVersions)
        .set({ pendingAudioCreateAttemptedAt: now })
        .where(
          and(
            eq(trackVersions.id, input.trackVersionId),
            eq(trackVersions.producerId, ctx.producerId),
            eq(trackVersions.trackId, staged.trackId),
            eq(trackVersions.purchaseId, staged.purchaseId),
            eq(trackVersions.pendingAudioR2Key, pending.key),
            isNull(trackVersions.pendingAudioUploadId),
            eq(trackVersions.pendingAudioInitiationDigest, pending.initiationDigest),
            eq(trackVersions.pendingAudioCompletionToken, pending.completionToken),
            eq(trackVersions.pendingAudioSizeBytes, pending.sizeBytes),
            pending.createAttemptedAt === null
              ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
              : eq(trackVersions.pendingAudioCreateAttemptedAt, pending.createAttemptedAt),
            isNull(trackVersions.pendingAudioCompleteAttemptedAt),
            isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt),
            isNull(trackVersions.pendingAudioPartUrlsExpireAt),
            isNull(trackVersions.pendingAudioCancelRequestedAt),
            isNull(trackVersions.pendingAudioCleanupEtag),
          ),
        )
        .returning({ id: trackVersions.id });
      if (!attempted) {
        throw new PendingMultipartCancellationError(
          "RECONCILIATION_PENDING",
          "The multipart create boundary changed before it was saved",
        );
      }
      return { kind: "create", createAttemptedAt: now };
    }

    const uploadId = decision.uploadId;
    const boundAttemptedAt = pending.createAttemptedAt ?? now;
    const [bound] = await tx
      .update(trackVersions)
      .set({
        pendingAudioUploadId: uploadId,
        pendingAudioCreateAttemptedAt: boundAttemptedAt,
      })
      .where(
        and(
          eq(trackVersions.id, input.trackVersionId),
          eq(trackVersions.producerId, ctx.producerId),
          eq(trackVersions.trackId, staged.trackId),
          eq(trackVersions.purchaseId, staged.purchaseId),
          eq(trackVersions.pendingAudioR2Key, pending.key),
          isNull(trackVersions.pendingAudioUploadId),
          eq(trackVersions.pendingAudioInitiationDigest, pending.initiationDigest),
          eq(trackVersions.pendingAudioCompletionToken, pending.completionToken),
          eq(trackVersions.pendingAudioSizeBytes, pending.sizeBytes),
          pending.createAttemptedAt === null
            ? isNull(trackVersions.pendingAudioCreateAttemptedAt)
            : eq(trackVersions.pendingAudioCreateAttemptedAt, pending.createAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt),
          isNull(trackVersions.pendingAudioPartUrlsExpireAt),
          isNull(trackVersions.pendingAudioCancelRequestedAt),
          isNull(trackVersions.pendingAudioCleanupEtag),
        ),
      )
      .returning({ id: trackVersions.id });
    if (!bound) {
      throw new PendingMultipartCancellationError(
        "RECONCILIATION_PENDING",
        "The server-issued multipart identity could not be bound",
      );
    }
    return {
      kind: "bound",
      result: { key: pending.key, uploadId, completionToken: pending.completionToken },
    };
  });
}

export const AUDIO_PART_URL_TTL_SECONDS = 900;

export function latestPendingAudioPartCapabilityExpiry(current: Date | null, issuedAt: Date): Date {
  const issuedAtMs = issuedAt.getTime();
  const currentMs = current?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(issuedAtMs) || (current !== null && !Number.isFinite(currentMs))) {
    throw new PendingMultipartCancellationError(
      "INTEGRITY_ERROR",
      "The pending part capability time is invalid",
    );
  }
  return new Date(Math.max(currentMs, issuedAtMs + AUDIO_PART_URL_TTL_SECONDS * 1000));
}

/**
 * Commit the latest UploadPart capability expiry before the presigned URL can
 * leave the server. The row lock and exact CAS make cancellation, cleanup,
 * completion, and signing mutually exclusive at this boundary.
 */
export async function authorizePendingMultipartPart<T>(
  ctx: Readonly<{ db: Db; producerId: string }>,
  input: Readonly<{
    trackVersionId: string;
    key: string;
    uploadId: string;
    partNumber: number;
    issuedAt: Date;
  }>,
  issue: (authorization: Readonly<{ expiresAt: Date; contentLength: number }>) => Promise<T>,
): Promise<T> {
  const discovered = await discoverOwnedVersion(ctx, input.trackVersionId);
  return ctx.db.transaction(async (tx) => {
    requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${discovered.projectId}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${discovered.purchaseId}, 0))`,
    );
    const [version] = await tx
      .select({
        trackId: trackVersions.trackId,
        versionProducerId: trackVersions.producerId,
        projectId: projectTracks.projectId,
        trackArchivedAt: projectTracks.archivedAt,
        projectProducerId: projects.producerId,
        projectLifecycleStatus: projects.lifecycleStatus,
        purchaseId: trackVersions.purchaseId,
        purchaseProducerId: purchases.producerId,
        purchaseProjectId: purchases.projectId,
        purchaseLifecycleStatus: purchases.lifecycleStatus,
        pendingAudioR2Key: trackVersions.pendingAudioR2Key,
        pendingAudioUploadId: trackVersions.pendingAudioUploadId,
        pendingAudioInitiationDigest: trackVersions.pendingAudioInitiationDigest,
        pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
        pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
        pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
        pendingAudioCreateAttemptedAt: trackVersions.pendingAudioCreateAttemptedAt,
        pendingAudioCompleteAttemptedAt: trackVersions.pendingAudioCompleteAttemptedAt,
        pendingAudioCompleteWriteOnceProtectedAt:
          trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
        pendingAudioPartUrlsExpireAt: trackVersions.pendingAudioPartUrlsExpireAt,
        pendingAudioCancelRequestedAt: trackVersions.pendingAudioCancelRequestedAt,
        pendingAudioCleanupEtag: trackVersions.pendingAudioCleanupEtag,
        audioDeletedAt: trackVersions.audioDeletedAt,
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
    const approvalAction = await currentTrackArtistApprovalAction(tx, {
      trackId: discovered.trackId,
      purchaseId: discovered.purchaseId,
      producerId: ctx.producerId,
    });
    assertOwnedActiveVersion(ctx.producerId, discovered, version, approvalAction);
    if (
      version.audioDeletedAt !== null ||
      !isAudioKeyForTrackVersion(input.key, {
        producerId: ctx.producerId,
        trackVersionId: input.trackVersionId,
      }) ||
      version.pendingAudioR2Key !== input.key ||
      version.pendingAudioUploadId !== input.uploadId ||
      typeof version.pendingAudioInitiationDigest !== "string" ||
      typeof version.pendingAudioCompletionToken !== "string" ||
      typeof version.pendingAudioSizeBytes !== "number" ||
      !(version.pendingAudioStartedAt instanceof Date) ||
      !(version.pendingAudioCreateAttemptedAt instanceof Date) ||
      version.pendingAudioCompleteAttemptedAt !== null ||
      version.pendingAudioCompleteWriteOnceProtectedAt !== null ||
      version.pendingAudioCancelRequestedAt !== null ||
      version.pendingAudioCleanupEtag !== null
    ) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The multipart upload identity is no longer active",
      );
    }

    const contentLength = expectedAudioMultipartPartSize(
      version.pendingAudioSizeBytes,
      input.partNumber,
    );
    if (contentLength === null) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The multipart part number is outside the pending upload",
      );
    }

    const expiresAt = latestPendingAudioPartCapabilityExpiry(
      version.pendingAudioPartUrlsExpireAt,
      input.issuedAt,
    );
    const [authorized] = await tx
      .update(trackVersions)
      .set({ pendingAudioPartUrlsExpireAt: expiresAt })
      .where(
        and(
          eq(trackVersions.id, input.trackVersionId),
          eq(trackVersions.producerId, ctx.producerId),
          eq(trackVersions.trackId, discovered.trackId),
          eq(trackVersions.purchaseId, discovered.purchaseId),
          isNull(trackVersions.audioDeletedAt),
          eq(trackVersions.pendingAudioR2Key, input.key),
          eq(trackVersions.pendingAudioUploadId, input.uploadId),
          eq(trackVersions.pendingAudioInitiationDigest, version.pendingAudioInitiationDigest),
          eq(trackVersions.pendingAudioCompletionToken, version.pendingAudioCompletionToken),
          eq(trackVersions.pendingAudioSizeBytes, version.pendingAudioSizeBytes),
          eq(trackVersions.pendingAudioStartedAt, version.pendingAudioStartedAt),
          eq(trackVersions.pendingAudioCreateAttemptedAt, version.pendingAudioCreateAttemptedAt),
          version.pendingAudioPartUrlsExpireAt === null
            ? isNull(trackVersions.pendingAudioPartUrlsExpireAt)
            : eq(trackVersions.pendingAudioPartUrlsExpireAt, version.pendingAudioPartUrlsExpireAt),
          isNull(trackVersions.pendingAudioCompleteAttemptedAt),
          isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt),
          isNull(trackVersions.pendingAudioCancelRequestedAt),
          isNull(trackVersions.pendingAudioCleanupEtag),
        ),
      )
      .returning({ id: trackVersions.id });
    if (!authorized) {
      throw new PendingMultipartCancellationError(
        "CONFLICT",
        "The multipart upload changed before the part capability was saved",
      );
    }
    return issue({ expiresAt, contentLength });
  });
}

async function discoverOwnedVersion(
  ctx: Readonly<{ db: Db; producerId: string }>,
  trackVersionId: string,
): Promise<Readonly<{ projectId: string; purchaseId: string; trackId: string }>> {
  const [version] = await ctx.db
    .select({
      trackId: trackVersions.trackId,
      purchaseId: trackVersions.purchaseId,
      projectId: projectTracks.projectId,
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
    .where(and(eq(trackVersions.id, trackVersionId), eq(trackVersions.producerId, ctx.producerId)))
    .limit(1);
  if (!version) {
    throw new PendingMultipartCancellationError("NOT_FOUND", "Audio upload was not found");
  }
  return version;
}

function assertOwnedActiveVersion(
  producerId: string,
  discovered: Readonly<{ projectId: string; purchaseId: string; trackId: string }>,
  version:
    | Readonly<{
        trackId: string;
        purchaseId: string;
        versionProducerId: string;
        projectId: string;
        trackArchivedAt: Date | null;
        projectProducerId: string;
        projectLifecycleStatus: (typeof projects.$inferSelect)["lifecycleStatus"];
        purchaseProducerId: string;
        purchaseProjectId: string;
        purchaseLifecycleStatus: (typeof purchases.$inferSelect)["lifecycleStatus"];
      }>
    | undefined,
  currentArtistApprovalAction: "approved" | "revoked" | null,
): asserts version is NonNullable<typeof version> {
  if (
    !version ||
    version.trackId !== discovered.trackId ||
    version.purchaseId !== discovered.purchaseId ||
    version.projectId !== discovered.projectId ||
    version.versionProducerId !== producerId ||
    version.projectProducerId !== producerId ||
    version.purchaseProducerId !== producerId ||
    version.purchaseProjectId !== discovered.projectId
  ) {
    throw new PendingMultipartCancellationError("NOT_FOUND", "Audio upload was not found");
  }
  assertActiveVersionUploadLifecycle(
    {
      producerId: version.projectProducerId,
      projectId: version.projectId,
      purchaseId: version.purchaseId,
      projectLifecycleStatus: version.projectLifecycleStatus,
      purchaseLifecycleStatus: version.purchaseLifecycleStatus,
      trackArchivedAt: version.trackArchivedAt,
      currentArtistApprovalAction,
    },
    { producerId, projectId: version.projectId, purchaseId: version.purchaseId },
  );
}

function assertUnattachedVersion(
  version: Readonly<{
    audioUrl: string | null;
    audioR2Key: string | null;
    attachedSizeBytes: number | null;
    audioObjectEtag: string | null;
    audioIdentityFingerprint: string | null;
    audioDeletedAt: Date | null;
  }>,
): void {
  if (
    version.audioUrl !== null ||
    version.audioR2Key !== null ||
    version.attachedSizeBytes !== null ||
    version.audioObjectEtag !== null ||
    version.audioIdentityFingerprint !== null ||
    version.audioDeletedAt !== null
  ) {
    throw new PendingMultipartCancellationError(
      "CONFLICT",
      "This upload placeholder is no longer available",
    );
  }
}

function readPendingInitiation(
  version: Readonly<{
    pendingAudioR2Key: string | null;
    pendingAudioUploadId: string | null;
    pendingAudioInitiationDigest: string | null;
    pendingAudioCompletionToken: string | null;
    pendingAudioSizeBytes: number | null;
    pendingAudioStartedAt: Date | null;
    pendingAudioCreateAttemptedAt: Date | null;
    pendingAudioCompleteAttemptedAt: Date | null;
    pendingAudioCompleteWriteOnceProtectedAt: Date | null;
    pendingAudioPartUrlsExpireAt: Date | null;
  }>,
): Readonly<{
  key: string;
  uploadId: string | null;
  initiationDigest: string;
  completionToken: string;
  sizeBytes: number;
  createAttemptedAt: Date | null;
}> | null {
  const values = [
    version.pendingAudioR2Key,
    version.pendingAudioInitiationDigest,
    version.pendingAudioCompletionToken,
    version.pendingAudioSizeBytes,
    version.pendingAudioStartedAt,
  ];
  const hasAny = values.some((value) => value !== null);
  if (!hasAny) {
    if (
      version.pendingAudioUploadId !== null ||
      version.pendingAudioCreateAttemptedAt !== null ||
      version.pendingAudioCompleteAttemptedAt !== null ||
      version.pendingAudioCompleteWriteOnceProtectedAt !== null ||
      version.pendingAudioPartUrlsExpireAt !== null
    ) {
      throw new PendingMultipartCancellationError(
        "INTEGRITY_ERROR",
        "The pending upload identity is incomplete",
      );
    }
    return null;
  }
  if (
    typeof version.pendingAudioR2Key !== "string" ||
    typeof version.pendingAudioInitiationDigest !== "string" ||
    typeof version.pendingAudioCompletionToken !== "string" ||
    typeof version.pendingAudioSizeBytes !== "number" ||
    !(version.pendingAudioStartedAt instanceof Date) ||
    !Number.isFinite(version.pendingAudioStartedAt.getTime()) ||
    (version.pendingAudioCreateAttemptedAt !== null &&
      (!(version.pendingAudioCreateAttemptedAt instanceof Date) ||
        !Number.isFinite(version.pendingAudioCreateAttemptedAt.getTime()) ||
        version.pendingAudioCreateAttemptedAt < version.pendingAudioStartedAt)) ||
    (version.pendingAudioUploadId !== null && version.pendingAudioCreateAttemptedAt === null) ||
    (version.pendingAudioPartUrlsExpireAt !== null &&
      (!(version.pendingAudioPartUrlsExpireAt instanceof Date) ||
        !Number.isFinite(version.pendingAudioPartUrlsExpireAt.getTime()) ||
        version.pendingAudioCreateAttemptedAt === null ||
        version.pendingAudioPartUrlsExpireAt < version.pendingAudioCreateAttemptedAt)) ||
    (version.pendingAudioCompleteAttemptedAt !== null &&
      (!(version.pendingAudioCompleteAttemptedAt instanceof Date) ||
        !Number.isFinite(version.pendingAudioCompleteAttemptedAt.getTime()) ||
        version.pendingAudioCreateAttemptedAt === null ||
        version.pendingAudioPartUrlsExpireAt === null ||
        version.pendingAudioCompleteAttemptedAt < version.pendingAudioCreateAttemptedAt)) ||
    (version.pendingAudioCompleteWriteOnceProtectedAt !== null &&
      (!(version.pendingAudioCompleteWriteOnceProtectedAt instanceof Date) ||
        !Number.isFinite(version.pendingAudioCompleteWriteOnceProtectedAt.getTime()) ||
        !(version.pendingAudioCompleteAttemptedAt instanceof Date) ||
        version.pendingAudioCompleteWriteOnceProtectedAt.getTime() !==
          version.pendingAudioCompleteAttemptedAt.getTime())) ||
    (version.pendingAudioUploadId !== null && version.pendingAudioUploadId.trim().length === 0) ||
    !/^sha256:[0-9a-f]{64}$/.test(version.pendingAudioInitiationDigest) ||
    !/^[0-9a-f]{64}$/.test(version.pendingAudioCompletionToken) ||
    !Number.isSafeInteger(version.pendingAudioSizeBytes) ||
    version.pendingAudioSizeBytes <= 0
  ) {
    throw new PendingMultipartCancellationError(
      "INTEGRITY_ERROR",
      "The pending upload identity is incomplete",
    );
  }
  return {
    key: version.pendingAudioR2Key,
    uploadId: version.pendingAudioUploadId,
    initiationDigest: version.pendingAudioInitiationDigest,
    completionToken: version.pendingAudioCompletionToken,
    sizeBytes: version.pendingAudioSizeBytes,
    createAttemptedAt: version.pendingAudioCreateAttemptedAt,
  };
}
