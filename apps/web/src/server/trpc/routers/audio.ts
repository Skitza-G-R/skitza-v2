import {
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  clientContacts,
  producers,
  projectTracks,
  projects,
  purchases,
  songPublicLinks,
  eq,
  isNotNull,
  isNull,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { AUDIO_UPLOAD_MAX_BYTES } from "~/lib/audio/storage-limits";
import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { computePeaksFromBytes } from "~/server/audio/peaks";
import {
  abortMultipartUploadAndObserve,
  exactObjectIsAbsent,
  listExactMultipartUploadIds,
  observeMultipartTerminalSealObject,
  putMultipartTerminalSeal,
  reconcileMultipartTerminalSeal,
  tokenBoundCompletedObjectCleanupMatches,
} from "~/server/audio/multipart-storage-recovery";
import {
  AUDIO_PART_URL_TTL_SECONDS,
  authorizePendingMultipartPart,
  createOrResumePendingMultipartUpload,
} from "~/server/audio/pending-multipart-initiation";
import {
  cancelPendingMultipartUpload,
  PendingMultipartCancellationError,
} from "~/server/audio/pending-multipart-cancellation";
import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import {
  requireSongUploadPublicExposureAcknowledgement as requireSongUploadPublicExposureAcknowledgementDomain,
  SongUploadPublicExposureError,
} from "~/server/domain/song-publication/upload-exposure";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
  type VersionUploadLifecycleCandidate,
  type VersionUploadLifecycleScope,
} from "~/server/domain/version-uploads/service";
import { currentTrackArtistApprovalAction } from "~/server/domain/version-uploads/db";
import { createStoredAudioIdentityFingerprint } from "~/server/domain/first-version-uploads/service";
import {
  AudioStorageQuotaError,
  lockProducerAudioStorageQuota,
  readProducerAudioStorageQuota,
} from "~/server/domain/audio-storage/quota";
import { reconcileProducerFirstVersionUploadReservations } from "~/server/domain/first-version-uploads/reconciliation";
import {
  lockProducerCapabilityState,
  type LockedProducerCapabilityState,
} from "~/server/domain/producer-capabilities/open-state";
import { SITE_URL, sendTrackVersionUploadedEmail } from "~/server/email/send";
import { emitArtistNewVersionNotification } from "~/server/artist/notification-emitters";
import {
  BUCKETS,
  getR2,
  getR2BrowserUpload,
  getR2SingleAttempt,
  isAudioKeyForTrackVersion,
} from "~/server/storage/r2";

export {
  reconcilePendingMultipartCancellation,
  type PendingMultipartCancellationIdentity,
  type PendingMultipartCancellationPort,
} from "~/server/audio/pending-multipart-cancellation";

// Cap server-side peaks compute so a malformed container can't hang the
// producer's upload response. 30s is comfortably above the worst-case
// decode of a 10-minute WAV at 44.1kHz; anything slower is almost
// certainly stuck, and we'd rather ship a null peaks column (client
// falls back to its own decode) than block the response forever.
const PEAKS_COMPUTE_TIMEOUT_MS = 30_000;

const AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA = "skitza-upload-token";

// Content types we accept. Browsers disagree on what to send for the
// same file extension (Safari/Chrome/Firefox each pick differently for
// m4a, aiff), so we accept all the common variants rather than being
// strict. The canonical set: WAV, MP3, FLAC, M4A, AIFF.
const ALLOWED_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aiff",
  "audio/x-aiff",
]);

export function createAudioIdentityFingerprint(input: {
  key: string;
  objectEtag: string;
  sizeBytes: number;
}): string {
  return createStoredAudioIdentityFingerprint(input);
}

export function validateUploadInput(input: {
  filename: string;
  sizeBytes: number;
  contentType: string;
}): void {
  if (input.sizeBytes > AUDIO_UPLOAD_MAX_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "File too large. Max 100MB.",
    });
  }
  if (!ALLOWED_TYPES.has(input.contentType.toLowerCase())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That's not an audio file we recognise. Try WAV, MP3, FLAC, M4A, or AIFF.",
    });
  }
}

export function validateMultipartCompletionParts(
  parts: readonly Readonly<{ partNumber: number; eTag: string }>[],
): void {
  let previousPartNumber = 0;
  if (parts.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Upload parts are invalid." });
  }
  for (const part of parts) {
    if (
      !Number.isInteger(part.partNumber) ||
      part.partNumber <= 0 ||
      part.partNumber > 10_000 ||
      part.partNumber <= previousPartNumber ||
      part.eTag.trim().length === 0
    ) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Upload parts are invalid." });
    }
    previousPartNumber = part.partNumber;
  }
}

export function validateCompletedAudioObjectIdentity(input: {
  claimedSizeBytes: number;
  completionToken: string;
  completedEtag: string | undefined;
  observedEtag: string | undefined;
  observedSizeBytes: number | undefined;
  observedCompletionToken: string | undefined;
}): { objectEtag: string; sizeBytes: number } {
  const completedEtag = input.completedEtag?.trim();
  const observedEtag = input.observedEtag?.trim();
  const observedSizeBytes = input.observedSizeBytes;
  if (
    !observedEtag ||
    (completedEtag !== undefined && completedEtag !== observedEtag) ||
    typeof observedSizeBytes !== "number" ||
    !Number.isSafeInteger(observedSizeBytes) ||
    observedSizeBytes <= 0 ||
    observedSizeBytes > AUDIO_UPLOAD_MAX_BYTES ||
    observedSizeBytes !== input.claimedSizeBytes ||
    input.completionToken.length !== 64 ||
    input.observedCompletionToken !== input.completionToken
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The completed audio object identity did not match the upload.",
    });
  }
  return { objectEtag: observedEtag, sizeBytes: observedSizeBytes };
}

export function completedAudioObjectIdentityMatches(input: {
  objectEtag: string | undefined;
  sizeBytes: number;
  completionToken: string;
  observedEtag: string | undefined;
  observedSizeBytes: number | undefined;
  observedCompletionToken: string | undefined;
}): boolean {
  const observedEtag = input.observedEtag?.trim();
  return (
    typeof observedEtag === "string" &&
    observedEtag.length > 0 &&
    (input.objectEtag === undefined || observedEtag === input.objectEtag.trim()) &&
    input.observedSizeBytes === input.sizeBytes &&
    input.completionToken.length === 64 &&
    input.observedCompletionToken === input.completionToken
  );
}

export type PendingAudioCleanupIdentity = Readonly<{
  key: string;
  uploadId: string;
  objectEtag: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type PendingAudioCleanupPort = Readonly<{
  abortExact(input: PendingAudioCleanupIdentity): Promise<boolean>;
  sealExact(input: PendingAudioCleanupIdentity): Promise<boolean>;
  clearExact(input: PendingAudioCleanupIdentity): Promise<boolean>;
}>;

export async function reconcilePendingAudioCleanup(
  input: PendingAudioCleanupIdentity,
  port: PendingAudioCleanupPort,
): Promise<boolean> {
  if (!(await port.abortExact(input))) return false;
  if (!(await port.sealExact(input))) return false;
  return port.clearExact(input);
}

type PendingAudioCompletionState = Readonly<{
  audioUrl: string | null;
  audioR2Key: string | null;
  sizeBytes: number | null;
  audioObjectEtag: string | null;
  audioIdentityFingerprint: string | null;
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
  pendingAudioCancelRequestedAt: Date | null;
  pendingAudioCleanupEtag: string | null;
}>;

type PendingAudioCompletionInput = Readonly<{
  key: string;
  uploadId: string;
  completionToken: string;
  sizeBytes: number;
}>;

export type PendingAudioCompletionDecision =
  | "stage"
  | "resume"
  | "observe_only"
  | "cancel_pending"
  | "cleanup_pending"
  | "already_attached";

function pendingAudioConflict(): never {
  throw new TRPCError({
    code: "CONFLICT",
    message: "This version has a different pending audio upload. Resume or clean it up first.",
  });
}

/**
 * Resolve the durable DB state before CompleteMultipart. A retry may resume
 * only the exact key/token/size tuple that was committed before the remote
 * operation; partial or substituted state always stops.
 */
export function resolvePendingAudioCompletion(
  state: PendingAudioCompletionState,
  input: PendingAudioCompletionInput,
): PendingAudioCompletionDecision {
  const audioValues = [
    state.audioUrl,
    state.audioR2Key,
    state.sizeBytes,
    state.audioObjectEtag,
    state.audioIdentityFingerprint,
  ];
  const hasAnyAudio = audioValues.some((value) => value !== null);
  const hasAllAudio = audioValues.every((value) => value !== null);
  const pendingValues = [
    state.pendingAudioR2Key,
    state.pendingAudioUploadId,
    state.pendingAudioInitiationDigest,
    state.pendingAudioCompletionToken,
    state.pendingAudioSizeBytes,
    state.pendingAudioStartedAt,
    state.pendingAudioCreateAttemptedAt,
  ];
  const hasAnyPending = pendingValues.some((value) => value !== null);
  const hasAllPending = pendingValues.every((value) => value !== null);

  if (
    input.key.length === 0 ||
    input.uploadId.trim().length === 0 ||
    !/^[0-9a-f]{64}$/.test(input.completionToken) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    (hasAnyAudio && !hasAllAudio) ||
    (hasAnyPending && !hasAllPending) ||
    (state.pendingAudioCleanupEtag !== null && !hasAllPending) ||
    (state.pendingAudioCompleteAttemptedAt !== null && !hasAllPending) ||
    (state.pendingAudioCompleteWriteOnceProtectedAt !== null && !hasAllPending) ||
    (state.pendingAudioPartUrlsExpireAt !== null && !hasAllPending) ||
    (state.pendingAudioCleanupEtag !== null && state.pendingAudioCleanupEtag.trim().length === 0) ||
    (state.pendingAudioCleanupEtag !== null && state.pendingAudioCompleteAttemptedAt === null) ||
    (state.pendingAudioCancelRequestedAt !== null && !hasAllPending) ||
    (state.pendingAudioCancelRequestedAt !== null &&
      (!(state.pendingAudioCancelRequestedAt instanceof Date) ||
        !Number.isFinite(state.pendingAudioCancelRequestedAt.getTime()))) ||
    (state.pendingAudioInitiationDigest !== null &&
      !/^sha256:[0-9a-f]{64}$/.test(state.pendingAudioInitiationDigest)) ||
    (state.pendingAudioCreateAttemptedAt !== null &&
      (!(state.pendingAudioCreateAttemptedAt instanceof Date) ||
        !Number.isFinite(state.pendingAudioCreateAttemptedAt.getTime()) ||
        !(state.pendingAudioStartedAt instanceof Date) ||
        state.pendingAudioCreateAttemptedAt < state.pendingAudioStartedAt)) ||
    (state.pendingAudioPartUrlsExpireAt !== null &&
      (!(state.pendingAudioPartUrlsExpireAt instanceof Date) ||
        !Number.isFinite(state.pendingAudioPartUrlsExpireAt.getTime()) ||
        !(state.pendingAudioCreateAttemptedAt instanceof Date) ||
        state.pendingAudioPartUrlsExpireAt < state.pendingAudioCreateAttemptedAt)) ||
    (state.pendingAudioCompleteAttemptedAt !== null &&
      (!(state.pendingAudioCompleteAttemptedAt instanceof Date) ||
        !Number.isFinite(state.pendingAudioCompleteAttemptedAt.getTime()) ||
        !(state.pendingAudioCreateAttemptedAt instanceof Date) ||
        state.pendingAudioPartUrlsExpireAt === null ||
        state.pendingAudioCompleteAttemptedAt < state.pendingAudioCreateAttemptedAt)) ||
    (state.pendingAudioCompleteWriteOnceProtectedAt !== null &&
      (!(state.pendingAudioCompleteWriteOnceProtectedAt instanceof Date) ||
        !Number.isFinite(state.pendingAudioCompleteWriteOnceProtectedAt.getTime()) ||
        !(state.pendingAudioCompleteAttemptedAt instanceof Date) ||
        state.pendingAudioCompleteWriteOnceProtectedAt.getTime() !==
          state.pendingAudioCompleteAttemptedAt.getTime())) ||
    (state.pendingAudioCancelRequestedAt !== null &&
      state.pendingAudioCompleteAttemptedAt !== null &&
      state.pendingAudioCancelRequestedAt < state.pendingAudioCompleteAttemptedAt) ||
    (hasAnyAudio && hasAnyPending)
  ) {
    return pendingAudioConflict();
  }

  if (hasAllAudio) {
    if (state.audioR2Key === input.key && state.sizeBytes === input.sizeBytes) {
      return "already_attached";
    }
    return pendingAudioConflict();
  }

  if (!hasAnyPending) return "stage";
  if (
    state.pendingAudioR2Key === input.key &&
    state.pendingAudioUploadId === input.uploadId &&
    state.pendingAudioCompletionToken === input.completionToken &&
    state.pendingAudioSizeBytes === input.sizeBytes &&
    state.pendingAudioStartedAt instanceof Date &&
    Number.isFinite(state.pendingAudioStartedAt.getTime())
  ) {
    if (state.pendingAudioCleanupEtag !== null) return "cleanup_pending";
    if (state.pendingAudioCancelRequestedAt !== null) return "cancel_pending";
    return state.pendingAudioCompleteAttemptedAt === null ? "resume" : "observe_only";
  }
  return pendingAudioConflict();
}

async function cleanupCompletedAudioObjectIfIdentityMatches(
  ctx: { db: Db; producerId: string },
  input: Readonly<{
    key: string;
    uploadId: string;
    objectEtag: string;
    sizeBytes: number;
    completionToken: string;
    trackVersionId: string;
    trackId: string;
    projectId: string;
    purchaseId: string;
  }>,
): Promise<boolean> {
  if (
    !isAudioKeyForTrackVersion(input.key, {
      producerId: ctx.producerId,
      trackVersionId: input.trackVersionId,
    })
  ) {
    return false;
  }

  try {
    const cleanupEtag = input.objectEtag.trim();
    if (!cleanupEtag) return false;

    const intentPublished = await ctx.db.transaction(async (tx) => {
      await lockProducerAudioStorageQuota(tx, ctx.producerId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`);
      const [version] = await tx
        .select({
          producerId: trackVersions.producerId,
          trackId: trackVersions.trackId,
          purchaseId: trackVersions.purchaseId,
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
          pendingAudioCompleteWriteOnceProtectedAt:
            trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
          pendingAudioPartUrlsExpireAt: trackVersions.pendingAudioPartUrlsExpireAt,
          pendingAudioCancelRequestedAt: trackVersions.pendingAudioCancelRequestedAt,
          pendingAudioCleanupEtag: trackVersions.pendingAudioCleanupEtag,
        })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.trackVersionId))
        .limit(1)
        .for("update");
      if (
        !version ||
        version.producerId !== ctx.producerId ||
        version.trackId !== input.trackId ||
        version.purchaseId !== input.purchaseId ||
        version.audioUrl !== null ||
        version.audioR2Key !== null ||
        version.sizeBytes !== null ||
        version.audioObjectEtag !== null ||
        version.audioIdentityFingerprint !== null ||
        version.audioDeletedAt !== null ||
        version.pendingAudioR2Key !== input.key ||
        version.pendingAudioUploadId !== input.uploadId ||
        typeof version.pendingAudioInitiationDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(version.pendingAudioInitiationDigest) ||
        version.pendingAudioCompletionToken !== input.completionToken ||
        version.pendingAudioSizeBytes !== input.sizeBytes ||
        version.pendingAudioStartedAt === null ||
        version.pendingAudioCreateAttemptedAt === null ||
        !(version.pendingAudioCompleteAttemptedAt instanceof Date) ||
        !(version.pendingAudioCompleteWriteOnceProtectedAt instanceof Date) ||
        version.pendingAudioCompleteWriteOnceProtectedAt.getTime() !==
          version.pendingAudioCompleteAttemptedAt.getTime() ||
        version.pendingAudioPartUrlsExpireAt === null ||
        version.pendingAudioCancelRequestedAt !== null
      ) {
        return false;
      }

      const [existingReference] = await tx
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(eq(trackVersions.audioR2Key, input.key))
        .limit(1)
        .for("update");
      if (existingReference) return false;

      if (version.pendingAudioCleanupEtag !== null) {
        return version.pendingAudioCleanupEtag === cleanupEtag;
      }

      if (!(await exactObjectIsAbsent(input.key))) {
        const head = await getR2().send(
          new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: input.key }),
        );
        if (
          !tokenBoundCompletedObjectCleanupMatches({
            expectedEtag: cleanupEtag,
            expectedCompletionToken: input.completionToken,
            observedEtag: head.ETag,
            observedCompletionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
          })
        ) {
          return false;
        }
      }
      const [published] = await tx
        .update(trackVersions)
        .set({ pendingAudioCleanupEtag: cleanupEtag })
        .where(
          and(
            eq(trackVersions.id, input.trackVersionId),
            eq(trackVersions.producerId, ctx.producerId),
            eq(trackVersions.trackId, input.trackId),
            eq(trackVersions.purchaseId, input.purchaseId),
            isNull(trackVersions.audioDeletedAt),
            eq(trackVersions.pendingAudioR2Key, input.key),
            eq(trackVersions.pendingAudioUploadId, input.uploadId),
            eq(trackVersions.pendingAudioInitiationDigest, version.pendingAudioInitiationDigest),
            eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
            eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
            isNotNull(trackVersions.pendingAudioStartedAt),
            eq(trackVersions.pendingAudioCreateAttemptedAt, version.pendingAudioCreateAttemptedAt),
            eq(
              trackVersions.pendingAudioCompleteAttemptedAt,
              version.pendingAudioCompleteAttemptedAt,
            ),
            eq(
              trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
              version.pendingAudioCompleteWriteOnceProtectedAt,
            ),
            eq(trackVersions.pendingAudioPartUrlsExpireAt, version.pendingAudioPartUrlsExpireAt),
            isNull(trackVersions.pendingAudioCancelRequestedAt),
            isNull(trackVersions.pendingAudioCleanupEtag),
          ),
        )
        .returning({ id: trackVersions.id });
      return published !== undefined;
    });
    if (!intentPublished) return false;

    return await ctx.db.transaction(async (tx) => {
      await lockProducerAudioStorageQuota(tx, ctx.producerId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`);
      const [version] = await tx
        .select({
          producerId: trackVersions.producerId,
          trackId: trackVersions.trackId,
          purchaseId: trackVersions.purchaseId,
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
          pendingAudioCompleteWriteOnceProtectedAt:
            trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
          pendingAudioPartUrlsExpireAt: trackVersions.pendingAudioPartUrlsExpireAt,
          pendingAudioCancelRequestedAt: trackVersions.pendingAudioCancelRequestedAt,
          pendingAudioCleanupEtag: trackVersions.pendingAudioCleanupEtag,
        })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.trackVersionId))
        .limit(1)
        .for("update");
      if (
        !version ||
        version.producerId !== ctx.producerId ||
        version.trackId !== input.trackId ||
        version.purchaseId !== input.purchaseId ||
        version.audioUrl !== null ||
        version.audioR2Key !== null ||
        version.sizeBytes !== null ||
        version.audioObjectEtag !== null ||
        version.audioIdentityFingerprint !== null ||
        version.audioDeletedAt !== null ||
        version.pendingAudioR2Key !== input.key ||
        version.pendingAudioUploadId !== input.uploadId ||
        typeof version.pendingAudioInitiationDigest !== "string" ||
        version.pendingAudioCompletionToken !== input.completionToken ||
        version.pendingAudioSizeBytes !== input.sizeBytes ||
        version.pendingAudioStartedAt === null ||
        version.pendingAudioCreateAttemptedAt === null ||
        !(version.pendingAudioCompleteAttemptedAt instanceof Date) ||
        !(version.pendingAudioCompleteWriteOnceProtectedAt instanceof Date) ||
        version.pendingAudioCompleteWriteOnceProtectedAt.getTime() !==
          version.pendingAudioCompleteAttemptedAt.getTime() ||
        version.pendingAudioPartUrlsExpireAt === null ||
        version.pendingAudioCancelRequestedAt !== null ||
        version.pendingAudioCleanupEtag !== cleanupEtag
      ) {
        return false;
      }

      const [existingReference] = await tx
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(eq(trackVersions.audioR2Key, input.key))
        .limit(1)
        .for("update");
      if (existingReference) return false;

      const initiationDigest = version.pendingAudioInitiationDigest;
      const createAttemptedAt = version.pendingAudioCreateAttemptedAt;
      const completeAttemptedAt = version.pendingAudioCompleteAttemptedAt;
      const completeWriteOnceProtectedAt = version.pendingAudioCompleteWriteOnceProtectedAt;
      const partUrlsExpireAt = version.pendingAudioPartUrlsExpireAt;

      return reconcilePendingAudioCleanup(
        {
          key: input.key,
          uploadId: input.uploadId,
          objectEtag: cleanupEtag,
          sizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
        },
        {
          async abortExact(exact) {
            const aborted = await abortMultipartUploadAndObserve(exact.key, exact.uploadId);
            if (!aborted.absent) return false;
            return (await listExactMultipartUploadIds(exact.key)).length === 0;
          },
          async sealExact(exact) {
            const sealed = await reconcileMultipartTerminalSeal(
              {
                key: exact.key,
                uploadId: exact.uploadId,
                completionToken: exact.completionToken,
                objectEtag: exact.objectEtag,
              },
              {
                head: observeMultipartTerminalSealObject,
                // The cleanup ETag was already journaled before storage
                // mutation. A different late object remains fail-closed.
                publishCleanupEtag: () => Promise.resolve(false),
                putSeal: putMultipartTerminalSeal,
              },
            );
            return sealed !== null;
          },
          async clearExact(exact) {
            const [cleared] = await tx
              .update(trackVersions)
              .set({
                pendingAudioR2Key: null,
                pendingAudioUploadId: null,
                pendingAudioInitiationDigest: null,
                pendingAudioCompletionToken: null,
                pendingAudioSizeBytes: null,
                pendingAudioStartedAt: null,
                pendingAudioCreateAttemptedAt: null,
                pendingAudioCompleteAttemptedAt: null,
                pendingAudioCompleteWriteOnceProtectedAt: null,
                pendingAudioPartUrlsExpireAt: null,
                pendingAudioCancelRequestedAt: null,
                pendingAudioCleanupEtag: null,
                audioDeletedAt: new Date(),
              })
              .where(
                and(
                  eq(trackVersions.id, input.trackVersionId),
                  eq(trackVersions.producerId, ctx.producerId),
                  eq(trackVersions.trackId, input.trackId),
                  eq(trackVersions.purchaseId, input.purchaseId),
                  isNull(trackVersions.audioDeletedAt),
                  eq(trackVersions.pendingAudioR2Key, exact.key),
                  eq(trackVersions.pendingAudioUploadId, input.uploadId),
                  eq(trackVersions.pendingAudioInitiationDigest, initiationDigest),
                  eq(trackVersions.pendingAudioCompletionToken, exact.completionToken),
                  eq(trackVersions.pendingAudioSizeBytes, exact.sizeBytes),
                  isNotNull(trackVersions.pendingAudioStartedAt),
                  eq(trackVersions.pendingAudioCreateAttemptedAt, createAttemptedAt),
                  eq(trackVersions.pendingAudioCompleteAttemptedAt, completeAttemptedAt),
                  eq(
                    trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
                    completeWriteOnceProtectedAt,
                  ),
                  eq(trackVersions.pendingAudioPartUrlsExpireAt, partUrlsExpireAt),
                  isNull(trackVersions.pendingAudioCancelRequestedAt),
                  eq(trackVersions.pendingAudioCleanupEtag, exact.objectEtag),
                ),
              )
              .returning({ id: trackVersions.id });
            return cleared !== undefined;
          },
        },
      );
    });
  } catch {
    // Cleanup is deliberately best-effort. Never replace the original safe
    // lifecycle/CAS/database error with a storage cleanup error.
    console.warn("[audio] completed-object cleanup could not be verified");
    return false;
  }
}

class AudioObjectObservationPending extends Error {}

export class CompletedAudioObjectCleanupRequiredError extends Error {
  constructor(readonly objectEtag: string) {
    super("The token-bound completed audio object must be cleaned up");
    this.name = "CompletedAudioObjectCleanupRequiredError";
  }
}

type AudioCompletionObservation = Readonly<{
  eTag: string | undefined;
  sizeBytes: number | undefined;
  completionToken: string | undefined;
}>;

export type AudioMultipartCompletionPort = Readonly<{
  head(key: string): Promise<AudioCompletionObservation | null>;
  complete(
    input: Readonly<{
      key: string;
      uploadId: string;
      parts: readonly Readonly<{ partNumber: number; eTag: string }>[];
    }>,
  ): Promise<Readonly<{ eTag: string | undefined }>>;
}>;

function r2AudioMultipartCompletionPort(): AudioMultipartCompletionPort {
  return {
    async head(key) {
      if (await exactObjectIsAbsent(key)) return null;
      const head = await getR2().send(new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
      return {
        eTag: head.ETag,
        sizeBytes: head.ContentLength,
        completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
      };
    },
    async complete(input) {
      const completed = await getR2SingleAttempt().send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          UploadId: input.uploadId,
          IfNoneMatch: "*",
          MultipartUpload: {
            Parts: input.parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.eTag,
            })),
          },
        }),
      );
      return { eTag: completed.ETag };
    },
  };
}

async function observeCompletedAudioObject(
  input: Readonly<{
    port: Pick<AudioMultipartCompletionPort, "head">;
    key: string;
    claimedSizeBytes: number;
    completionToken: string;
    completedEtag: string | undefined;
  }>,
): Promise<{ objectEtag: string; sizeBytes: number } | null> {
  try {
    const head = await input.port.head(input.key);
    if (head === null) return null;
    try {
      return validateCompletedAudioObjectIdentity({
        claimedSizeBytes: input.claimedSizeBytes,
        completionToken: input.completionToken,
        completedEtag: input.completedEtag,
        observedEtag: head.eTag,
        observedSizeBytes: head.sizeBytes,
        observedCompletionToken: head.completionToken,
      });
    } catch (error) {
      const cleanupEtag = head.eTag?.trim();
      if (
        error instanceof TRPCError &&
        cleanupEtag &&
        tokenBoundCompletedObjectCleanupMatches({
          expectedEtag: null,
          expectedCompletionToken: input.completionToken,
          observedEtag: head.eTag,
          observedCompletionToken: head.completionToken,
        })
      ) {
        throw new CompletedAudioObjectCleanupRequiredError(cleanupEtag);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof CompletedAudioObjectCleanupRequiredError) throw error;
    if (error instanceof TRPCError) throw error;
    throw new AudioObjectObservationPending();
  }
}

export async function observePendingCompletedAudioObject(
  input: Readonly<{
    key: string;
    claimedSizeBytes: number;
    completionToken: string;
  }>,
  port: Pick<AudioMultipartCompletionPort, "head"> = r2AudioMultipartCompletionPort(),
): Promise<{ objectEtag: string; sizeBytes: number } | null> {
  let missingObservations = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const observed = await observeCompletedAudioObject({
        port,
        key: input.key,
        claimedSizeBytes: input.claimedSizeBytes,
        completionToken: input.completionToken,
        completedEtag: undefined,
      });
      if (observed) return observed;
      missingObservations += 1;
    } catch (error) {
      if (!(error instanceof AudioObjectObservationPending)) throw error;
    }
  }
  if (missingObservations === 3) return null;
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The pending audio object could not be observed yet. Please retry.",
  });
}

export async function completeOrRecoverMultipart(
  input: Readonly<{
    key: string;
    uploadId: string;
    parts: readonly Readonly<{ partNumber: number; eTag: string }>[];
    claimedSizeBytes: number;
    completionToken: string;
    completeWasAttempted: boolean;
  }>,
  port: AudioMultipartCompletionPort = r2AudioMultipartCompletionPort(),
): Promise<{ objectEtag: string; sizeBytes: number }> {
  // A retry first reconciles a completion whose response was lost. It never
  // replays CompleteMultipart when the exact token-bound object is visible.
  let missingObservations = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const recovered = await observeCompletedAudioObject({
        port,
        key: input.key,
        claimedSizeBytes: input.claimedSizeBytes,
        completionToken: input.completionToken,
        completedEtag: undefined,
      });
      if (recovered) return recovered;
      missingObservations += 1;
    } catch (error) {
      if (!(error instanceof AudioObjectObservationPending)) throw error;
    }
  }
  if (missingObservations !== 3) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The audio upload state could not be observed yet. Please retry.",
    });
  }

  if (input.completeWasAttempted) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The earlier audio completion is still being reconciled. Please retry.",
    });
  }

  let completedEtag: string | undefined;
  try {
    const completed = await port.complete({
      key: input.key,
      uploadId: input.uploadId,
      parts: input.parts,
    });
    completedEtag = completed.eTag;
  } catch {
    // CompleteMultipart can commit remotely while its response is lost. The
    // exact token, key, and size are reconciled below instead of replaying it.
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const recovered = await observeCompletedAudioObject({
        port,
        key: input.key,
        claimedSizeBytes: input.claimedSizeBytes,
        completionToken: input.completionToken,
        completedEtag,
      });
      if (recovered) return recovered;
    } catch (error) {
      if (!(error instanceof AudioObjectObservationPending)) throw error;
    }
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The completed audio object could not be reconciled yet. Please retry.",
  });
}

// Fetch the just-uploaded object back from R2 (via S3 protocol — no
// CDN cache lag the public URL route would hit) and reduce its samples
// to 200 normalized RMS peaks. Bounded by PEAKS_COMPUTE_TIMEOUT_MS so a
// hung decoder can't block the producer's upload response. Returns
// null on any failure — the Waveform50 client decode is the fallback.
async function computeUploadPeaks(key: string): Promise<number[] | null> {
  const compute = (async (): Promise<number[] | null> => {
    try {
      const obj = await getR2().send(new GetObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
      if (!obj.Body) return null;
      const bytes = await obj.Body.transformToByteArray();
      return await computePeaksFromBytes(bytes);
    } catch (err) {
      console.warn("[peaks] GetObject failed:", err instanceof Error ? err.message : String(err));
      return null;
    }
  })();
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, PEAKS_COMPUTE_TIMEOUT_MS);
  });
  return Promise.race([compute, timeout]);
}

function mapVersionUploadDomainError(error: unknown): never {
  if (!(error instanceof VersionUploadDomainError)) throw error;
  if (error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function requireMultipartProducerOpen(producer: LockedProducerCapabilityState | null): void {
  if (!producer || producer.closedAt !== null) {
    throw new VersionUploadDomainError("INACTIVE", "This studio is closed");
  }
}

function mapAudioStorageQuotaError(error: unknown): never {
  if (!(error instanceof AudioStorageQuotaError)) throw error;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
}

function requireSongUploadPublicExposureAcknowledgement(input: {
  linkEnabled: boolean;
  portfolioPublished: boolean;
  acknowledged: boolean;
}): void {
  try {
    requireSongUploadPublicExposureAcknowledgementDomain(input);
  } catch (error) {
    if (error instanceof SongUploadPublicExposureError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
    }
    throw error;
  }
}

async function assertVersionUploadAllowed(
  db: Pick<Db, "select">,
  candidate: Omit<VersionUploadLifecycleCandidate, "currentArtistApprovalAction"> | null,
  expected: VersionUploadLifecycleScope,
  trackId: string,
): Promise<void> {
  const currentArtistApprovalAction = candidate
    ? await currentTrackArtistApprovalAction(db, {
        trackId,
        purchaseId: candidate.purchaseId,
        producerId: candidate.producerId,
      })
    : null;
  assertActiveVersionUploadLifecycle(
    candidate ? { ...candidate, currentArtistApprovalAction } : null,
    expected,
  );
}

function mapPendingMultipartCancellationError(error: unknown): never {
  if (!(error instanceof PendingMultipartCancellationError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}

type UploadPlaceholder = Readonly<{
  audioUrl: string | null;
  audioR2Key: string | null;
  sizeBytes: number | null;
  audioObjectEtag: string | null;
  audioIdentityFingerprint: string | null;
  audioDeletedAt: Date | null;
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
  pendingAudioCancelRequestedAt: Date | null;
  pendingAudioCleanupEtag: string | null;
}>;

function assertAvailableUploadPlaceholder(version: UploadPlaceholder): void {
  if (
    version.audioDeletedAt ||
    version.audioUrl ||
    version.audioR2Key ||
    version.sizeBytes !== null ||
    version.audioObjectEtag ||
    version.audioIdentityFingerprint ||
    version.pendingAudioR2Key ||
    version.pendingAudioUploadId ||
    version.pendingAudioInitiationDigest ||
    version.pendingAudioCompletionToken ||
    version.pendingAudioSizeBytes !== null ||
    version.pendingAudioStartedAt ||
    version.pendingAudioCreateAttemptedAt ||
    version.pendingAudioCompleteAttemptedAt ||
    version.pendingAudioCompleteWriteOnceProtectedAt ||
    version.pendingAudioPartUrlsExpireAt ||
    version.pendingAudioCancelRequestedAt ||
    version.pendingAudioCleanupEtag
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This upload placeholder is no longer available.",
    });
  }
}

// Ownership and active-lifecycle walk starting from a trackVersion id.
// Completion repeats this check under stable row locks after R2 finishes.
async function assertOwnsVersion(
  ctx: { db: Db; producerId: string },
  trackVersionId: string,
  requirePlaceholder = true,
  requireActiveLifecycle = true,
): Promise<{ projectId: string; purchaseId: string; trackId: string }> {
  const [tv] = await ctx.db
    .select({
      id: trackVersions.id,
      trackId: trackVersions.trackId,
      versionProducerId: trackVersions.producerId,
      purchaseId: trackVersions.purchaseId,
      projectId: projectTracks.projectId,
      trackArchivedAt: projectTracks.archivedAt,
      producerId: projects.producerId,
      purchaseProducerId: purchases.producerId,
      purchaseProjectId: purchases.projectId,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      projectLifecycleStatus: projects.lifecycleStatus,
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
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, projects.producerId),
      ),
    )
    .where(eq(trackVersions.id, trackVersionId))
    .limit(1);
  try {
    if (
      !tv ||
      tv.versionProducerId !== ctx.producerId ||
      tv.purchaseProducerId !== ctx.producerId ||
      tv.purchaseProjectId !== tv.projectId
    ) {
      throw new VersionUploadDomainError(
        "NOT_FOUND",
        "The purchase-owned version binding was not found",
      );
    }
    if (requireActiveLifecycle) {
      await assertVersionUploadAllowed(
        ctx.db,
        {
          producerId: tv.producerId,
          projectId: tv.projectId,
          purchaseId: tv.purchaseId,
          purchaseLifecycleStatus: tv.purchaseLifecycleStatus,
          projectLifecycleStatus: tv.projectLifecycleStatus,
          trackArchivedAt: tv.trackArchivedAt,
        },
        {
          producerId: ctx.producerId,
          projectId: tv.projectId,
          purchaseId: tv.purchaseId,
        },
        tv.trackId,
      );
    }
  } catch (error) {
    mapVersionUploadDomainError(error);
  }
  if (requirePlaceholder) assertAvailableUploadPlaceholder(tv);
  return { projectId: tv.projectId, purchaseId: tv.purchaseId, trackId: tv.trackId };
}

export const audioRouter = router({
  storageUsage: producerProcedure.query(({ ctx }) =>
    readProducerAudioStorageQuota(ctx.db, ctx.producerId),
  ),
  reconcileStorageUsage: producerProcedure.mutation(({ ctx }) =>
    reconcileProducerFirstVersionUploadReservations(ctx.db, ctx.producerId),
  ),

  // Start a multipart upload. Client then calls signPart N times and
  // completeMultipart once. Returns { uploadId, key } — the key is a
  // producer-scoped path, used as an ownership handle for later calls.
  initMultipart: producerProcedure
    .input(
      z.object({
        trackVersionId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive().max(AUDIO_UPLOAD_MAX_BYTES),
        contentType: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validateUploadInput(input);
      try {
        return await createOrResumePendingMultipartUpload(ctx, input);
      } catch (error) {
        if (error instanceof VersionUploadDomainError) mapVersionUploadDomainError(error);
        if (error instanceof AudioStorageQuotaError) mapAudioStorageQuotaError(error);
        mapPendingMultipartCancellationError(error);
      }
    }),

  // Return a presigned URL for a single part (PUT). Re-check lifecycle on
  // every presign so paused/completed/canceled work cannot receive bytes.
  signPart: producerProcedure
    .input(
      z.object({
        key: z.string(),
        uploadId: z.string(),
        partNumber: z.number().int().min(1).max(10000),
        trackVersionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !isAudioKeyForTrackVersion(input.key, {
          producerId: ctx.producerId,
          trackVersionId: input.trackVersionId,
        })
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const issuedAt = new Date();
      try {
        // Commit the exact byte capability and its expiry before any signed
        // URL can leave the server, while the Producer closure lock is held.
        return await authorizePendingMultipartPart(
          ctx,
          { ...input, issuedAt },
          async ({ contentLength }) => {
            const cmd = new UploadPartCommand({
              Bucket: BUCKETS.audio,
              Key: input.key,
              UploadId: input.uploadId,
              PartNumber: input.partNumber,
              ContentLength: contentLength,
            });
            const url = await getSignedUrl(getR2BrowserUpload(), cmd, {
              expiresIn: AUDIO_PART_URL_TTL_SECONDS,
              signingDate: issuedAt,
              signableHeaders: new Set(["content-length"]),
            });
            return { url };
          },
        );
      } catch (error) {
        if (error instanceof VersionUploadDomainError) mapVersionUploadDomainError(error);
        mapPendingMultipartCancellationError(error);
      }
    }),

  // Finalise the multipart upload and record the object on the
  // trackVersion row. Before remote completion, this publishes the exact
  // server-owned recovery identity that completion or cancellation resumes.
  completeMultipart: producerProcedure
    .input(
      z.object({
        key: z.string(),
        uploadId: z.string(),
        parts: z
          .array(
            z.object({
              partNumber: z.number().int().min(1).max(10_000),
              eTag: z.string().refine((value) => value.trim().length > 0),
            }),
          )
          .min(1),
        trackVersionId: z.string().uuid(),
        sizeBytes: z.number().int().positive().max(AUDIO_UPLOAD_MAX_BYTES),
        completionToken: z.string().regex(/^[0-9a-f]{64}$/),
        acknowledgePublicExposure: z.boolean(),
        durationMs: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validateMultipartCompletionParts(input.parts);
      if (
        !isAudioKeyForTrackVersion(input.key, {
          producerId: ctx.producerId,
          trackVersionId: input.trackVersionId,
        })
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { projectId, purchaseId, trackId } = await assertOwnsVersion(
        ctx,
        input.trackVersionId,
        false,
        false,
      );

      // Publish a database recovery record before CompleteMultipart can commit
      // remotely. A process restart can resume only this exact tuple; an
      // already-attached response retry returns the committed DB result.
      let staged:
        | Readonly<{ kind: "already_attached"; url: string; key: string }>
        | Readonly<{ kind: "cleanup_pending"; objectEtag: string }>
        | Readonly<{ kind: "cancel_pending"; objectEtag: string | null }>
        | Readonly<{ kind: "inactive_pending" }>
        | Readonly<{ kind: "pending"; completeWasAttempted: boolean }>;
      try {
        staged = await ctx.db.transaction(async (tx) => {
          const producer = await lockProducerCapabilityState(tx, ctx.producerId);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${purchaseId}, 0))`);
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1)
            .for("update");
          const [lockedPurchase] = await tx
            .select({
              id: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              lifecycleStatus: purchases.lifecycleStatus,
            })
            .from(purchases)
            .where(eq(purchases.id, purchaseId))
            .limit(1)
            .for("update");
          const [lockedVersion] = await tx
            .select({
              id: trackVersions.id,
              trackId: trackVersions.trackId,
              versionProducerId: trackVersions.producerId,
              purchaseId: trackVersions.purchaseId,
              projectId: projectTracks.projectId,
              trackArchivedAt: projectTracks.archivedAt,
              portfolioPublishedAt: projectTracks.portfolioPublishedAt,
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
            .where(eq(trackVersions.id, input.trackVersionId))
            .limit(1)
            .for("update");

          if (
            !lockedVersion ||
            !lockedProject ||
            !lockedPurchase ||
            lockedVersion.trackId !== trackId ||
            lockedVersion.projectId !== projectId ||
            lockedVersion.purchaseId !== purchaseId ||
            lockedVersion.versionProducerId !== ctx.producerId ||
            lockedVersion.audioDeletedAt !== null ||
            lockedProject.producerId !== ctx.producerId ||
            lockedPurchase.producerId !== ctx.producerId ||
            lockedPurchase.projectId !== projectId
          ) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version binding changed before completion",
            );
          }

          const decision = resolvePendingAudioCompletion(lockedVersion, {
            key: input.key,
            uploadId: input.uploadId,
            completionToken: input.completionToken,
            sizeBytes: input.sizeBytes,
          });
          if (decision === "already_attached") {
            return {
              kind: "already_attached" as const,
              url: lockedVersion.audioUrl as string,
              key: lockedVersion.audioR2Key as string,
            };
          }
          if (decision === "cleanup_pending") {
            return {
              kind: "cleanup_pending" as const,
              objectEtag: lockedVersion.pendingAudioCleanupEtag as string,
            };
          }
          if (decision === "cancel_pending") {
            return {
              kind: "cancel_pending" as const,
              objectEtag: lockedVersion.pendingAudioCleanupEtag,
            };
          }
          try {
            await assertVersionUploadAllowed(
              tx,
              {
                producerId: lockedProject.producerId,
                projectId: lockedProject.id,
                purchaseId: lockedPurchase.id,
                projectLifecycleStatus: lockedProject.lifecycleStatus,
                purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                trackArchivedAt: lockedVersion.trackArchivedAt,
              },
              { producerId: ctx.producerId, projectId, purchaseId },
              lockedVersion.trackId,
            );
          } catch (error) {
            if (
              (decision === "resume" || decision === "observe_only") &&
              error instanceof VersionUploadDomainError &&
              error.code === "INACTIVE"
            ) {
              return { kind: "inactive_pending" as const };
            }
            throw error;
          }
          requireMultipartProducerOpen(producer);
          if (decision === "stage") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The server-issued multipart identity was not initialized.",
            });
          }
          const [publicLink] = await tx
            .select({ disabledAt: songPublicLinks.disabledAt })
            .from(songPublicLinks)
            .where(
              and(
                eq(songPublicLinks.trackId, trackId),
                eq(songPublicLinks.purchaseId, purchaseId),
                eq(songPublicLinks.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          requireSongUploadPublicExposureAcknowledgement({
            linkEnabled: publicLink?.disabledAt === null,
            portfolioPublished: lockedVersion.portfolioPublishedAt !== null,
            acknowledged: input.acknowledgePublicExposure,
          });
          return {
            kind: "pending" as const,
            completeWasAttempted: decision === "observe_only",
          };
        });
      } catch (error) {
        mapVersionUploadDomainError(error);
      }
      if (staged.kind === "already_attached") {
        return { url: staged.url, key: staged.key };
      }
      if (staged.kind === "cancel_pending") {
        try {
          await cancelPendingMultipartUpload(ctx, {
            trackVersionId: input.trackVersionId,
            expected: {
              key: input.key,
              uploadId: input.uploadId,
              sizeBytes: input.sizeBytes,
              completionToken: input.completionToken,
            },
          });
        } catch (error) {
          mapPendingMultipartCancellationError(error);
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "This upload was canceled. Please start a new upload.",
        });
      }
      if (staged.kind === "cleanup_pending") {
        const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
          uploadId: input.uploadId,
          objectEtag: staged.objectEtag,
          sizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
          trackVersionId: input.trackVersionId,
          trackId,
          projectId,
          purchaseId,
        });
        throw new TRPCError({
          code: cleanupFinished ? "CONFLICT" : "INTERNAL_SERVER_ERROR",
          message: cleanupFinished
            ? "The previous upload was safely cleaned up. Please start this upload again."
            : "The previous upload cleanup is still being verified. Please retry.",
        });
      }
      if (staged.kind === "inactive_pending") {
        let observed: { objectEtag: string; sizeBytes: number } | null;
        try {
          observed = await observePendingCompletedAudioObject({
            key: input.key,
            claimedSizeBytes: input.sizeBytes,
            completionToken: input.completionToken,
          });
        } catch (error) {
          if (!(error instanceof CompletedAudioObjectCleanupRequiredError)) throw error;
          const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
            key: input.key,
            uploadId: input.uploadId,
            objectEtag: error.objectEtag,
            sizeBytes: input.sizeBytes,
            completionToken: input.completionToken,
            trackVersionId: input.trackVersionId,
            trackId,
            projectId,
            purchaseId,
          });
          throw new TRPCError({
            code: cleanupFinished ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
            message: cleanupFinished
              ? "This inactive upload did not match and was safely cleaned up."
              : "The inactive upload cleanup is still being verified. Please retry.",
          });
        }
        if (observed === null) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The inactive upload cleanup is still being verified. Please retry.",
          });
        }
        const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
          uploadId: input.uploadId,
          objectEtag: observed.objectEtag,
          sizeBytes: observed.sizeBytes,
          completionToken: input.completionToken,
          trackVersionId: input.trackVersionId,
          trackId,
          projectId,
          purchaseId,
        });
        throw new TRPCError({
          code: cleanupFinished ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
          message: cleanupFinished
            ? "This upload became inactive and was safely cleaned up."
            : "The inactive upload cleanup is still being verified. Please retry.",
        });
      }

      // Commit the non-idempotent boundary before the sole remote completion.
      // Once this timestamp exists, every retry is observation-only.
      let completionBoundary:
        | Readonly<{ kind: "already_attached"; url: string; key: string }>
        | Readonly<{ kind: "completion"; completeWasAttempted: boolean }>;
      try {
        completionBoundary = await ctx.db.transaction(async (tx) => {
          const producer = await lockProducerCapabilityState(tx, ctx.producerId);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${purchaseId}, 0))`);
          const [lockedVersion] = await tx
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
              and(
                eq(projects.id, projectTracks.projectId),
                eq(projects.producerId, ctx.producerId),
              ),
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
            !lockedVersion ||
            lockedVersion.trackId !== trackId ||
            lockedVersion.purchaseId !== purchaseId ||
            lockedVersion.projectId !== projectId ||
            lockedVersion.versionProducerId !== ctx.producerId ||
            lockedVersion.projectProducerId !== ctx.producerId ||
            lockedVersion.purchaseProducerId !== ctx.producerId ||
            lockedVersion.purchaseProjectId !== projectId ||
            lockedVersion.audioDeletedAt !== null
          ) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version binding changed before remote completion",
            );
          }
          await assertVersionUploadAllowed(
            tx,
            {
              producerId: lockedVersion.projectProducerId,
              projectId: lockedVersion.projectId,
              purchaseId: lockedVersion.purchaseId,
              projectLifecycleStatus: lockedVersion.projectLifecycleStatus,
              purchaseLifecycleStatus: lockedVersion.purchaseLifecycleStatus,
              trackArchivedAt: lockedVersion.trackArchivedAt,
            },
            { producerId: ctx.producerId, projectId, purchaseId },
            lockedVersion.trackId,
          );
          const decision = resolvePendingAudioCompletion(lockedVersion, {
            key: input.key,
            uploadId: input.uploadId,
            completionToken: input.completionToken,
            sizeBytes: input.sizeBytes,
          });
          if (decision === "already_attached") {
            return {
              kind: "already_attached" as const,
              url: lockedVersion.audioUrl as string,
              key: lockedVersion.audioR2Key as string,
            };
          }
          requireMultipartProducerOpen(producer);
          if (decision === "observe_only") {
            return { kind: "completion" as const, completeWasAttempted: true };
          }
          if (decision !== "resume" || lockedVersion.pendingAudioPartUrlsExpireAt === null) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The pending audio upload changed before remote completion.",
            });
          }
          const completeAttemptedAt = new Date();
          const [journaled] = await tx
            .update(trackVersions)
            .set({
              pendingAudioCompleteAttemptedAt: completeAttemptedAt,
              pendingAudioCompleteWriteOnceProtectedAt: completeAttemptedAt,
            })
            .where(
              and(
                eq(trackVersions.id, input.trackVersionId),
                eq(trackVersions.producerId, ctx.producerId),
                eq(trackVersions.trackId, trackId),
                eq(trackVersions.purchaseId, purchaseId),
                isNull(trackVersions.audioDeletedAt),
                eq(trackVersions.pendingAudioR2Key, input.key),
                eq(trackVersions.pendingAudioUploadId, input.uploadId),
                eq(
                  trackVersions.pendingAudioInitiationDigest,
                  lockedVersion.pendingAudioInitiationDigest as string,
                ),
                eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
                eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
                eq(
                  trackVersions.pendingAudioStartedAt,
                  lockedVersion.pendingAudioStartedAt as Date,
                ),
                eq(
                  trackVersions.pendingAudioCreateAttemptedAt,
                  lockedVersion.pendingAudioCreateAttemptedAt as Date,
                ),
                eq(
                  trackVersions.pendingAudioPartUrlsExpireAt,
                  lockedVersion.pendingAudioPartUrlsExpireAt,
                ),
                isNull(trackVersions.pendingAudioCompleteAttemptedAt),
                isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt),
                isNull(trackVersions.pendingAudioCancelRequestedAt),
                isNull(trackVersions.pendingAudioCleanupEtag),
              ),
            )
            .returning({ id: trackVersions.id });
          if (!journaled) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The completion boundary changed before it was saved.",
            });
          }
          return { kind: "completion" as const, completeWasAttempted: false };
        });
      } catch (error) {
        if (error instanceof VersionUploadDomainError) mapVersionUploadDomainError(error);
        throw error;
      }
      if (completionBoundary.kind === "already_attached") {
        return { url: completionBoundary.url, key: completionBoundary.key };
      }
      const completionInput = {
        key: input.key,
        uploadId: input.uploadId,
        parts: input.parts,
        claimedSizeBytes: input.sizeBytes,
        completionToken: input.completionToken,
      } as const;
      let completedObject: { objectEtag: string; sizeBytes: number };
      try {
        completedObject = completionBoundary.completeWasAttempted
          ? await completeOrRecoverMultipart({ ...completionInput, completeWasAttempted: true })
          : await ctx.db.transaction(async (tx) => {
              // The attempt marker is already committed. Reacquire both locks
              // so cancellation in the commit/call gap wins safely; if this
              // transaction wins, it keeps them through the sole remote call.
              requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
              );
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${purchaseId}, 0))`,
              );
              const [lockedVersion] = await tx
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
                .innerJoin(projects, eq(projects.id, projectTracks.projectId))
                .innerJoin(
                  purchases,
                  and(
                    eq(purchases.id, trackVersions.purchaseId),
                    eq(purchases.projectId, projectTracks.projectId),
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
                !lockedVersion ||
                lockedVersion.trackId !== trackId ||
                lockedVersion.purchaseId !== purchaseId ||
                lockedVersion.projectId !== projectId ||
                lockedVersion.versionProducerId !== ctx.producerId ||
                lockedVersion.projectProducerId !== ctx.producerId ||
                lockedVersion.purchaseProducerId !== ctx.producerId ||
                lockedVersion.purchaseProjectId !== projectId ||
                lockedVersion.audioDeletedAt !== null
              ) {
                throw new VersionUploadDomainError(
                  "NOT_FOUND",
                  "The purchase-owned version binding changed before remote completion",
                );
              }
              await assertVersionUploadAllowed(
                tx,
                {
                  producerId: lockedVersion.projectProducerId,
                  projectId: lockedVersion.projectId,
                  purchaseId: lockedVersion.purchaseId,
                  projectLifecycleStatus: lockedVersion.projectLifecycleStatus,
                  purchaseLifecycleStatus: lockedVersion.purchaseLifecycleStatus,
                  trackArchivedAt: lockedVersion.trackArchivedAt,
                },
                { producerId: ctx.producerId, projectId, purchaseId },
                lockedVersion.trackId,
              );
              if (
                resolvePendingAudioCompletion(lockedVersion, {
                  key: input.key,
                  uploadId: input.uploadId,
                  completionToken: input.completionToken,
                  sizeBytes: input.sizeBytes,
                }) !== "observe_only"
              ) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "The completion boundary changed before the remote call.",
                });
              }
              return completeOrRecoverMultipart({
                ...completionInput,
                completeWasAttempted: false,
              });
            });
      } catch (error) {
        if (error instanceof VersionUploadDomainError) mapVersionUploadDomainError(error);
        if (!(error instanceof CompletedAudioObjectCleanupRequiredError)) throw error;
        const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
          uploadId: input.uploadId,
          objectEtag: error.objectEtag,
          sizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
          trackVersionId: input.trackVersionId,
          trackId,
          projectId,
          purchaseId,
        });
        throw new TRPCError({
          code: cleanupFinished ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
          message: cleanupFinished
            ? "The completed upload did not match and was safely cleaned up. Please start again."
            : "The completed upload cleanup is still being verified. Please retry.",
        });
      }
      const { objectEtag, sizeBytes: observedSizeBytes } = completedObject;
      const audioIdentityFingerprint = createAudioIdentityFingerprint({
        key: input.key,
        objectEtag,
        sizeBytes: observedSizeBytes,
      });

      const url = privateVersionStreamPath(input.trackVersionId);

      // Pre-compute waveform peaks server-side so the L3 song page
      // renders the real envelope on first frame. Fetch the bytes back
      // from R2 via GetObject (S3 protocol, no CDN cache lag), decode
      // with audio-decode, RMS-reduce to 200 bars. Bounded with a
      // timeout because a malformed container could otherwise hang
      // the response. Failure here is non-fatal — we save peaks=null
      // and the client-side decode in Waveform50 picks up the slack.
      const peaks = await computeUploadPeaks(input.key);

      try {
        await ctx.db.transaction(async (tx) => {
          requireMultipartProducerOpen(await lockProducerCapabilityState(tx, ctx.producerId));
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${purchaseId}, 0))`);
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1)
            .for("update");
          const [lockedPurchase] = await tx
            .select({
              id: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              lifecycleStatus: purchases.lifecycleStatus,
            })
            .from(purchases)
            .where(eq(purchases.id, purchaseId))
            .limit(1)
            .for("update");
          const [lockedVersion] = await tx
            .select({
              id: trackVersions.id,
              trackId: trackVersions.trackId,
              versionProducerId: trackVersions.producerId,
              purchaseId: trackVersions.purchaseId,
              projectId: projectTracks.projectId,
              trackArchivedAt: projectTracks.archivedAt,
              portfolioPublishedAt: projectTracks.portfolioPublishedAt,
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
            .where(eq(trackVersions.id, input.trackVersionId))
            .limit(1)
            .for("update");

          await assertVersionUploadAllowed(
            tx,
            lockedProject && lockedPurchase && lockedVersion
              ? {
                  producerId: lockedProject.producerId,
                  projectId: lockedProject.id,
                  purchaseId: lockedPurchase.id,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                  trackArchivedAt: lockedVersion.trackArchivedAt,
                }
              : null,
            { producerId: ctx.producerId, projectId, purchaseId },
            trackId,
          );
          if (
            !lockedVersion ||
            lockedVersion.trackId !== trackId ||
            lockedVersion.projectId !== projectId ||
            lockedVersion.purchaseId !== purchaseId ||
            lockedVersion.versionProducerId !== ctx.producerId ||
            lockedPurchase?.producerId !== ctx.producerId ||
            lockedPurchase.projectId !== projectId
          ) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version binding changed before completion",
            );
          }
          const [publicLink] = await tx
            .select({ disabledAt: songPublicLinks.disabledAt })
            .from(songPublicLinks)
            .where(
              and(
                eq(songPublicLinks.trackId, trackId),
                eq(songPublicLinks.purchaseId, purchaseId),
                eq(songPublicLinks.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          requireSongUploadPublicExposureAcknowledgement({
            linkEnabled: publicLink?.disabledAt === null,
            portfolioPublished: lockedVersion.portfolioPublishedAt !== null,
            acknowledged: input.acknowledgePublicExposure,
          });
          if (
            resolvePendingAudioCompletion(lockedVersion, {
              key: input.key,
              uploadId: input.uploadId,
              completionToken: input.completionToken,
              sizeBytes: observedSizeBytes,
            }) !== "observe_only"
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The pending audio upload changed before it could be attached.",
            });
          }

          const [updatedVersion] = await tx
            .update(trackVersions)
            .set({
              audioUrl: url,
              audioR2Key: input.key,
              sizeBytes: observedSizeBytes,
              audioObjectEtag: objectEtag,
              audioIdentityFingerprint,
              pendingAudioR2Key: null,
              pendingAudioUploadId: null,
              pendingAudioInitiationDigest: null,
              pendingAudioCompletionToken: null,
              pendingAudioSizeBytes: null,
              pendingAudioStartedAt: null,
              pendingAudioCreateAttemptedAt: null,
              pendingAudioCompleteAttemptedAt: null,
              pendingAudioCompleteWriteOnceProtectedAt: null,
              pendingAudioPartUrlsExpireAt: null,
              pendingAudioCancelRequestedAt: null,
              pendingAudioCleanupEtag: null,
              peaks,
              ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
            })
            .where(
              and(
                eq(trackVersions.id, input.trackVersionId),
                isNull(trackVersions.audioDeletedAt),
                isNull(trackVersions.audioUrl),
                isNull(trackVersions.audioR2Key),
                isNull(trackVersions.sizeBytes),
                isNull(trackVersions.audioObjectEtag),
                isNull(trackVersions.audioIdentityFingerprint),
                eq(trackVersions.pendingAudioR2Key, input.key),
                eq(trackVersions.pendingAudioUploadId, input.uploadId),
                isNotNull(trackVersions.pendingAudioInitiationDigest),
                eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
                eq(trackVersions.pendingAudioSizeBytes, observedSizeBytes),
                isNotNull(trackVersions.pendingAudioStartedAt),
                isNotNull(trackVersions.pendingAudioCreateAttemptedAt),
                isNotNull(trackVersions.pendingAudioCompleteAttemptedAt),
                lockedVersion.pendingAudioCompleteWriteOnceProtectedAt === null
                  ? isNull(trackVersions.pendingAudioCompleteWriteOnceProtectedAt)
                  : eq(
                      trackVersions.pendingAudioCompleteWriteOnceProtectedAt,
                      lockedVersion.pendingAudioCompleteWriteOnceProtectedAt,
                    ),
                isNotNull(trackVersions.pendingAudioPartUrlsExpireAt),
                isNull(trackVersions.pendingAudioCancelRequestedAt),
                isNull(trackVersions.pendingAudioCleanupEtag),
              ),
            )
            .returning({ id: trackVersions.id });
          if (!updatedVersion) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This upload placeholder changed before completion.",
            });
          }
          await tx
            .update(projects)
            .set({ updatedAt: new Date() })
            .where(and(eq(projects.id, projectId), eq(projects.producerId, ctx.producerId)));
        });
      } catch (error) {
        await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
          uploadId: input.uploadId,
          objectEtag,
          sizeBytes: observedSizeBytes,
          completionToken: input.completionToken,
          trackVersionId: input.trackVersionId,
          trackId,
          projectId,
          purchaseId,
        });
        mapVersionUploadDomainError(error);
      }

      // C1 — fire the "new version uploaded" email AFTER the audioUrl is
      // patched. addVersion runs at the START of the upload chain (with
      // audioUrl=null) so emailing there would point the artist at a
      // missing file. Look up the version label + project recipient
      // details and enqueue via after() so the response returns fast.
      const [versionRow] = await ctx.db
        .select({ label: trackVersions.label })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.trackVersionId))
        .limit(1);
      const [projectRow] = await ctx.db
        .select({
          title: projects.title,
          artistName: projects.artistName,
          artistEmail: projects.artistEmail,
          clientContactId: projects.clientContactId,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.producerId, ctx.producerId)))
        .limit(1);
      const [trackRow] = await ctx.db
        .select({ title: projectTracks.title })
        .from(projectTracks)
        .where(
          and(
            eq(projectTracks.id, trackId),
            eq(projectTracks.projectId, projectId),
            eq(projectTracks.purchaseId, purchaseId),
          ),
        )
        .limit(1);
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      const [artistContact] = projectRow
        ? await ctx.db
            .select({ clerkUserId: clientContacts.clerkUserId })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.id, projectRow.clientContactId),
                eq(clientContacts.producerId, ctx.producerId),
                isNull(clientContacts.archivedAt),
              ),
            )
            .limit(1)
        : [];
      if (versionRow && projectRow && trackRow) {
        const label = versionRow.label;
        const artistEmail = projectRow.artistEmail;
        const artistName = projectRow.artistName;
        const projectTitle = projectRow.title;
        const trackTitle = trackRow.title;
        const producerName = producerRow?.displayName ?? "Your producer";
        after(async () => {
          let emailEnabled = false;
          try {
            const delivery = await emitArtistNewVersionNotification(ctx.db, {
              recipientClerkUserId: artistContact?.clerkUserId ?? null,
              producerId: ctx.producerId,
              trackVersionId: input.trackVersionId,
              producerName,
              trackTitle,
              versionLabel: label,
            });
            emailEnabled = delivery.emailEnabled;
          } catch (error) {
            console.warn("[artist-notify] track-version event failed", error);
          }
          if (!emailEnabled) return;
          try {
            await sendTrackVersionUploadedEmail(artistEmail, {
              artistName,
              producerName,
              projectName: projectTitle,
              versionLabel: label,
              reviewUrl: `${SITE_URL}/artist/music/song/${input.trackVersionId}`,
            });
          } catch (err) {
            console.error("[email] track-version-uploaded failed", err);
          }
        });
      }

      return { url, key: input.key };
    }),

  // Persist the exact cancellation before touching R2. A retry or the
  // incomplete-version cleanup path can safely resume after any crash.
  abortMultipart: producerProcedure
    .input(
      z.object({
        key: z.string(),
        uploadId: z.string().min(1),
        trackVersionId: z.string().uuid(),
        sizeBytes: z.number().int().positive().max(AUDIO_UPLOAD_MAX_BYTES),
        completionToken: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await cancelPendingMultipartUpload(ctx, {
          trackVersionId: input.trackVersionId,
          expected: {
            key: input.key,
            uploadId: input.uploadId,
            sizeBytes: input.sizeBytes,
            completionToken: input.completionToken,
          },
        });
      } catch (error) {
        mapPendingMultipartCancellationError(error);
      }
      return { ok: true as const };
    }),
});
