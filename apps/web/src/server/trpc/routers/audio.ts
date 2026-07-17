import { createHash, randomBytes } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  producers,
  projectTracks,
  projects,
  purchases,
  eq,
  isNotNull,
  isNull,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { computePeaksFromBytes } from "~/server/audio/peaks";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
} from "~/server/domain/version-uploads/service";
import { SITE_URL, sendTrackVersionUploadedEmail } from "~/server/email/send";
import {
  BUCKETS,
  buildAudioKey,
  getR2,
  isAudioKeyForTrackVersion,
  publicUrl,
} from "~/server/storage/r2";

// Cap server-side peaks compute so a malformed container can't hang the
// producer's upload response. 30s is comfortably above the worst-case
// decode of a 10-minute WAV at 44.1kHz; anything slower is almost
// certainly stuck, and we'd rather ship a null peaks column (client
// falls back to its own decode) than block the response forever.
const PEAKS_COMPUTE_TIMEOUT_MS = 30_000;

// 500MB is the cap for a single audio upload — comfortably above a
// 24-bit/48kHz stereo WAV at album length, well under R2's 5TB object
// limit, and small enough that a browser can hold one part in memory.
const MAX_BYTES = 500 * 1024 * 1024;
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

export function validateUploadInput(input: {
  filename: string;
  sizeBytes: number;
  contentType: string;
}): void {
  if (input.sizeBytes > MAX_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "File too large. Max 500MB.",
    });
  }
  if (!ALLOWED_TYPES.has(input.contentType.toLowerCase())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That's not an audio file we recognise. Try WAV, MP3, FLAC, M4A, or AIFF.",
    });
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
    observedSizeBytes > MAX_BYTES ||
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
  objectEtag: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type PendingAudioCleanupPort = Readonly<{
  head(key: string): Promise<Readonly<{
    eTag: string | undefined;
    sizeBytes: number | undefined;
    completionToken: string | undefined;
  }> | null>;
  deleteExact(input: Readonly<{ key: string; ifMatch: string }>): Promise<void>;
  clearExact(input: PendingAudioCleanupIdentity): Promise<boolean>;
}>;

export async function reconcilePendingAudioCleanup(
  input: PendingAudioCleanupIdentity,
  port: PendingAudioCleanupPort,
): Promise<boolean> {
  const observed = await port.head(input.key);
  if (observed === null) return port.clearExact(input);
  if (
    !completedAudioObjectIdentityMatches({
      objectEtag: input.objectEtag,
      sizeBytes: input.sizeBytes,
      completionToken: input.completionToken,
      observedEtag: observed.eTag,
      observedSizeBytes: observed.sizeBytes,
      observedCompletionToken: observed.completionToken,
    })
  ) {
    return false;
  }

  await port.deleteExact({ key: input.key, ifMatch: input.objectEtag });
  if ((await port.head(input.key)) !== null) return false;
  return port.clearExact(input);
}

type PendingAudioCompletionState = Readonly<{
  audioUrl: string | null;
  audioR2Key: string | null;
  sizeBytes: number | null;
  audioObjectEtag: string | null;
  audioIdentityFingerprint: string | null;
  pendingAudioR2Key: string | null;
  pendingAudioCompletionToken: string | null;
  pendingAudioSizeBytes: number | null;
  pendingAudioStartedAt: Date | null;
  pendingAudioCleanupEtag: string | null;
}>;

type PendingAudioCompletionInput = Readonly<{
  key: string;
  completionToken: string;
  sizeBytes: number;
}>;

export type PendingAudioCompletionDecision =
  | "stage"
  | "resume"
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
    state.pendingAudioCompletionToken,
    state.pendingAudioSizeBytes,
    state.pendingAudioStartedAt,
  ];
  const hasAnyPending = pendingValues.some((value) => value !== null);
  const hasAllPending = pendingValues.every((value) => value !== null);

  if (
    input.key.length === 0 ||
    !/^[0-9a-f]{64}$/.test(input.completionToken) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    (hasAnyAudio && !hasAllAudio) ||
    (hasAnyPending && !hasAllPending) ||
    (state.pendingAudioCleanupEtag !== null && !hasAllPending) ||
    (state.pendingAudioCleanupEtag !== null && state.pendingAudioCleanupEtag.trim().length === 0) ||
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
    state.pendingAudioCompletionToken === input.completionToken &&
    state.pendingAudioSizeBytes === input.sizeBytes &&
    state.pendingAudioStartedAt instanceof Date &&
    Number.isFinite(state.pendingAudioStartedAt.getTime())
  ) {
    return state.pendingAudioCleanupEtag === null ? "resume" : "cleanup_pending";
  }
  return pendingAudioConflict();
}

async function cleanupCompletedAudioObjectIfIdentityMatches(
  ctx: { db: Db; producerId: string },
  input: Readonly<{
    key: string;
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
          pendingAudioR2Key: trackVersions.pendingAudioR2Key,
          pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
          pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
          pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
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
        version.pendingAudioR2Key !== input.key ||
        version.pendingAudioCompletionToken !== input.completionToken ||
        version.pendingAudioSizeBytes !== input.sizeBytes ||
        version.pendingAudioStartedAt === null
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

      let head;
      try {
        head = await getR2().send(new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: input.key }));
      } catch (error) {
        if (!isMissingAudioObject(error)) throw error;
        return false;
      }
      if (
        !completedAudioObjectIdentityMatches({
          objectEtag: input.objectEtag,
          sizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
          observedEtag: head.ETag,
          observedSizeBytes: head.ContentLength,
          observedCompletionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
        })
      ) {
        return false;
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
            eq(trackVersions.pendingAudioR2Key, input.key),
            eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
            eq(trackVersions.pendingAudioSizeBytes, input.sizeBytes),
            isNotNull(trackVersions.pendingAudioStartedAt),
            isNull(trackVersions.pendingAudioCleanupEtag),
          ),
        )
        .returning({ id: trackVersions.id });
      return published !== undefined;
    });
    if (!intentPublished) return false;

    return await ctx.db.transaction(async (tx) => {
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
          pendingAudioR2Key: trackVersions.pendingAudioR2Key,
          pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
          pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
          pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
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
        version.pendingAudioR2Key !== input.key ||
        version.pendingAudioCompletionToken !== input.completionToken ||
        version.pendingAudioSizeBytes !== input.sizeBytes ||
        version.pendingAudioStartedAt === null ||
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

      return reconcilePendingAudioCleanup(
        {
          key: input.key,
          objectEtag: cleanupEtag,
          sizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
        },
        {
          async head(key) {
            try {
              const head = await getR2().send(
                new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: key }),
              );
              return {
                eTag: head.ETag,
                sizeBytes: head.ContentLength,
                completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
              };
            } catch (error) {
              if (isMissingAudioObject(error)) return null;
              throw error;
            }
          },
          async deleteExact({ key, ifMatch }) {
            await getR2().send(
              new DeleteObjectCommand({
                Bucket: BUCKETS.audio,
                Key: key,
                IfMatch: ifMatch,
              }),
            );
          },
          async clearExact(exact) {
            const [cleared] = await tx
              .update(trackVersions)
              .set({
                pendingAudioR2Key: null,
                pendingAudioCompletionToken: null,
                pendingAudioSizeBytes: null,
                pendingAudioStartedAt: null,
                pendingAudioCleanupEtag: null,
              })
              .where(
                and(
                  eq(trackVersions.id, input.trackVersionId),
                  eq(trackVersions.producerId, ctx.producerId),
                  eq(trackVersions.trackId, input.trackId),
                  eq(trackVersions.purchaseId, input.purchaseId),
                  eq(trackVersions.pendingAudioR2Key, exact.key),
                  eq(trackVersions.pendingAudioCompletionToken, exact.completionToken),
                  eq(trackVersions.pendingAudioSizeBytes, exact.sizeBytes),
                  isNotNull(trackVersions.pendingAudioStartedAt),
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

function isMissingAudioObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

class AudioObjectObservationPending extends Error {}

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
      try {
        const head = await getR2().send(new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
        return {
          eTag: head.ETag,
          sizeBytes: head.ContentLength,
          completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
        };
      } catch (error) {
        if (isMissingAudioObject(error)) return null;
        throw error;
      }
    },
    async complete(input) {
      const completed = await getR2().send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          UploadId: input.uploadId,
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
    return validateCompletedAudioObjectIdentity({
      claimedSizeBytes: input.claimedSizeBytes,
      completionToken: input.completionToken,
      completedEtag: input.completedEtag,
      observedEtag: head.eTag,
      observedSizeBytes: head.sizeBytes,
      observedCompletionToken: head.completionToken,
    });
  } catch (error) {
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

type UploadPlaceholder = Readonly<{
  audioUrl: string | null;
  audioR2Key: string | null;
  sizeBytes: number | null;
  audioObjectEtag: string | null;
  audioIdentityFingerprint: string | null;
  audioDeletedAt: Date | null;
  pendingAudioR2Key: string | null;
  pendingAudioCompletionToken: string | null;
  pendingAudioSizeBytes: number | null;
  pendingAudioStartedAt: Date | null;
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
    version.pendingAudioCompletionToken ||
    version.pendingAudioSizeBytes !== null ||
    version.pendingAudioStartedAt ||
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
      pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
      pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
      pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
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
      assertActiveVersionUploadLifecycle(
        {
          producerId: tv.producerId,
          projectId: tv.projectId,
          purchaseId: tv.purchaseId,
          purchaseLifecycleStatus: tv.purchaseLifecycleStatus,
          projectLifecycleStatus: tv.projectLifecycleStatus,
        },
        {
          producerId: ctx.producerId,
          projectId: tv.projectId,
          purchaseId: tv.purchaseId,
        },
      );
    }
  } catch (error) {
    mapVersionUploadDomainError(error);
  }
  if (requirePlaceholder) assertAvailableUploadPlaceholder(tv);
  return { projectId: tv.projectId, purchaseId: tv.purchaseId, trackId: tv.trackId };
}

export const audioRouter = router({
  // Start a multipart upload. Client then calls signPart N times and
  // completeMultipart once. Returns { uploadId, key } — the key is a
  // producer-scoped path, used as an ownership handle for later calls.
  initMultipart: producerProcedure
    .input(
      z.object({
        trackVersionId: z.string().uuid(),
        filename: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive().max(MAX_BYTES),
        contentType: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validateUploadInput(input);
      await assertOwnsVersion(ctx, input.trackVersionId);
      const key = buildAudioKey({
        producerId: ctx.producerId,
        trackVersionId: input.trackVersionId,
        filename: input.filename,
      });
      const completionToken = randomBytes(32).toString("hex");
      const res = await getR2().send(
        new CreateMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: key,
          ContentType: input.contentType,
          Metadata: { [AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA]: completionToken },
        }),
      );
      if (!res.UploadId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "R2 did not return an upload id",
        });
      }
      return { uploadId: res.UploadId, key, completionToken };
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
      await assertOwnsVersion(ctx, input.trackVersionId);
      const cmd = new UploadPartCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      });
      const url = await getSignedUrl(getR2(), cmd, { expiresIn: 900 });
      return { url };
    }),

  // Finalise the multipart upload and record the object on the
  // trackVersion row. This is the only place we touch the DB for audio
  // uploads — everything before it is R2-only state.
  completeMultipart: producerProcedure
    .input(
      z.object({
        key: z.string(),
        uploadId: z.string(),
        parts: z.array(z.object({ partNumber: z.number().int(), eTag: z.string() })).min(1),
        trackVersionId: z.string().uuid(),
        sizeBytes: z.number().int().positive().max(MAX_BYTES),
        completionToken: z.string().regex(/^[0-9a-f]{64}$/),
        durationMs: z.number().int().positive().optional(),
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
        | Readonly<{ kind: "inactive_pending" }>
        | Readonly<{ kind: "pending" }>;
      try {
        staged = await ctx.db.transaction(async (tx) => {
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
              audioUrl: trackVersions.audioUrl,
              audioR2Key: trackVersions.audioR2Key,
              sizeBytes: trackVersions.sizeBytes,
              audioObjectEtag: trackVersions.audioObjectEtag,
              audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
              audioDeletedAt: trackVersions.audioDeletedAt,
              pendingAudioR2Key: trackVersions.pendingAudioR2Key,
              pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
              pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
              pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
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
          try {
            assertActiveVersionUploadLifecycle(
              {
                producerId: lockedProject.producerId,
                projectId: lockedProject.id,
                purchaseId: lockedPurchase.id,
                projectLifecycleStatus: lockedProject.lifecycleStatus,
                purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
              },
              { producerId: ctx.producerId, projectId, purchaseId },
            );
          } catch (error) {
            if (
              decision === "resume" &&
              error instanceof VersionUploadDomainError &&
              error.code === "INACTIVE"
            ) {
              return { kind: "inactive_pending" as const };
            }
            throw error;
          }
          if (decision === "stage") {
            const [pending] = await tx
              .update(trackVersions)
              .set({
                pendingAudioR2Key: input.key,
                pendingAudioCompletionToken: input.completionToken,
                pendingAudioSizeBytes: input.sizeBytes,
                pendingAudioStartedAt: new Date(),
                pendingAudioCleanupEtag: null,
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
                  isNull(trackVersions.pendingAudioR2Key),
                  isNull(trackVersions.pendingAudioCompletionToken),
                  isNull(trackVersions.pendingAudioSizeBytes),
                  isNull(trackVersions.pendingAudioStartedAt),
                  isNull(trackVersions.pendingAudioCleanupEtag),
                ),
              )
              .returning({ id: trackVersions.id });
            if (!pending) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "The pending audio upload changed before it could be saved.",
              });
            }
          }
          return { kind: "pending" as const };
        });
      } catch (error) {
        mapVersionUploadDomainError(error);
      }
      if (staged.kind === "already_attached") {
        return { url: staged.url, key: staged.key };
      }
      if (staged.kind === "cleanup_pending") {
        const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
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
        const observed = await observePendingCompletedAudioObject({
          key: input.key,
          claimedSizeBytes: input.sizeBytes,
          completionToken: input.completionToken,
        });
        if (observed === null) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The inactive upload cleanup is still being verified. Please retry.",
          });
        }
        const cleanupFinished = await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
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

      const { objectEtag, sizeBytes: observedSizeBytes } = await completeOrRecoverMultipart({
        key: input.key,
        uploadId: input.uploadId,
        parts: input.parts,
        claimedSizeBytes: input.sizeBytes,
        completionToken: input.completionToken,
      });
      const audioIdentityFingerprint = createAudioIdentityFingerprint({
        key: input.key,
        objectEtag,
        sizeBytes: observedSizeBytes,
      });

      let url: string;
      try {
        url = publicUrl("audio", input.key);
      } catch (error) {
        await cleanupCompletedAudioObjectIfIdentityMatches(ctx, {
          key: input.key,
          objectEtag,
          sizeBytes: observedSizeBytes,
          completionToken: input.completionToken,
          trackVersionId: input.trackVersionId,
          trackId,
          projectId,
          purchaseId,
        });
        throw error;
      }

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
              audioUrl: trackVersions.audioUrl,
              audioR2Key: trackVersions.audioR2Key,
              sizeBytes: trackVersions.sizeBytes,
              audioObjectEtag: trackVersions.audioObjectEtag,
              audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
              audioDeletedAt: trackVersions.audioDeletedAt,
              pendingAudioR2Key: trackVersions.pendingAudioR2Key,
              pendingAudioCompletionToken: trackVersions.pendingAudioCompletionToken,
              pendingAudioSizeBytes: trackVersions.pendingAudioSizeBytes,
              pendingAudioStartedAt: trackVersions.pendingAudioStartedAt,
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

          assertActiveVersionUploadLifecycle(
            lockedProject && lockedPurchase && lockedVersion
              ? {
                  producerId: lockedProject.producerId,
                  projectId: lockedProject.id,
                  purchaseId: lockedPurchase.id,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                }
              : null,
            { producerId: ctx.producerId, projectId, purchaseId },
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
          if (
            resolvePendingAudioCompletion(lockedVersion, {
              key: input.key,
              completionToken: input.completionToken,
              sizeBytes: observedSizeBytes,
            }) !== "resume"
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
              pendingAudioCompletionToken: null,
              pendingAudioSizeBytes: null,
              pendingAudioStartedAt: null,
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
                eq(trackVersions.pendingAudioCompletionToken, input.completionToken),
                eq(trackVersions.pendingAudioSizeBytes, observedSizeBytes),
                isNotNull(trackVersions.pendingAudioStartedAt),
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
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      if (versionRow && projectRow) {
        const label = versionRow.label;
        const artistEmail = projectRow.artistEmail;
        const artistName = projectRow.artistName;
        const projectTitle = projectRow.title;
        const producerName = producerRow?.displayName ?? "Your producer";
        after(async () => {
          try {
            await sendTrackVersionUploadedEmail(artistEmail, {
              artistName,
              producerName,
              projectName: projectTitle,
              versionLabel: label,
              reviewUrl: `${SITE_URL}/artist/music`,
            });
          } catch (err) {
            console.error("[email] track-version-uploaded failed", err);
          }
        });
      }

      return { url, key: input.key };
    }),

  // Best-effort cancel. R2 will eventually garbage-collect orphaned
  // parts even without this, but calling abort reclaims storage
  // immediately.
  abortMultipart: producerProcedure
    .input(z.object({ key: z.string(), uploadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`producers/${ctx.producerId}/`)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await getR2().send(
        new AbortMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          UploadId: input.uploadId,
        }),
      );
      return { ok: true as const };
    }),
});
