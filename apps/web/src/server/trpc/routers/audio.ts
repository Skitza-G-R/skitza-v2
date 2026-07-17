import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
  type HeadObjectCommandOutput,
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
  completedEtag: string | undefined;
  observedEtag: string | undefined;
  observedSizeBytes: number | undefined;
}): { objectEtag: string; sizeBytes: number } {
  const completedEtag = input.completedEtag?.trim();
  const observedEtag = input.observedEtag?.trim();
  const observedSizeBytes = input.observedSizeBytes;
  if (
    !completedEtag ||
    !observedEtag ||
    completedEtag !== observedEtag ||
    typeof observedSizeBytes !== "number" ||
    !Number.isSafeInteger(observedSizeBytes) ||
    observedSizeBytes <= 0 ||
    observedSizeBytes > MAX_BYTES ||
    observedSizeBytes !== input.claimedSizeBytes
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The completed audio object identity did not match the upload.",
    });
  }
  return { objectEtag: observedEtag, sizeBytes: observedSizeBytes };
}

export function completedAudioObjectIdentityMatches(input: {
  objectEtag: string;
  sizeBytes: number;
  observedEtag: string | undefined;
  observedSizeBytes: number | undefined;
}): boolean {
  return (
    input.observedEtag?.trim() === input.objectEtag.trim() &&
    input.observedSizeBytes === input.sizeBytes
  );
}

async function cleanupCompletedAudioObjectIfIdentityMatches(
  ctx: { db: Db; producerId: string },
  input: Readonly<{
    key: string;
    objectEtag: string;
    sizeBytes: number;
    trackVersionId: string;
    trackId: string;
    projectId: string;
    purchaseId: string;
  }>,
): Promise<void> {
  if (
    !isAudioKeyForTrackVersion(input.key, {
      producerId: ctx.producerId,
      trackVersionId: input.trackVersionId,
    })
  ) {
    return;
  }

  try {
    await ctx.db.transaction(async (tx) => {
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
        version.audioIdentityFingerprint !== null
      ) {
        return;
      }

      const [existingReference] = await tx
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(eq(trackVersions.audioR2Key, input.key))
        .limit(1)
        .for("update");
      if (existingReference) return;

      const head = await getR2().send(
        new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: input.key }),
      );
      if (
        !completedAudioObjectIdentityMatches({
          objectEtag: input.objectEtag,
          sizeBytes: input.sizeBytes,
          observedEtag: head.ETag,
          observedSizeBytes: head.ContentLength,
        })
      ) {
        return;
      }
      await getR2().send(
        new DeleteObjectCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          IfMatch: input.objectEtag,
        }),
      );
    });
  } catch {
    // Cleanup is deliberately best-effort. Never replace the original safe
    // lifecycle/CAS/database error with a storage cleanup error.
    console.warn("[audio] completed-object cleanup could not be verified");
  }
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
}>;

function assertAvailableUploadPlaceholder(version: UploadPlaceholder): void {
  if (
    version.audioDeletedAt ||
    version.audioUrl ||
    version.audioR2Key ||
    version.sizeBytes !== null ||
    version.audioObjectEtag ||
    version.audioIdentityFingerprint
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
    assertActiveVersionUploadLifecycle(
      tv
        ? {
            producerId: tv.producerId,
            projectId: tv.projectId,
            purchaseId: tv.purchaseId,
            purchaseLifecycleStatus: tv.purchaseLifecycleStatus,
            projectLifecycleStatus: tv.projectLifecycleStatus,
          }
        : null,
      {
        producerId: ctx.producerId,
        projectId: tv?.projectId ?? "",
        purchaseId: tv?.purchaseId ?? "",
      },
    );
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
  } catch (error) {
    mapVersionUploadDomainError(error);
  }
  assertAvailableUploadPlaceholder(tv);
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
      const res = await getR2().send(
        new CreateMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: key,
          ContentType: input.contentType,
        }),
      );
      if (!res.UploadId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "R2 did not return an upload id",
        });
      }
      return { uploadId: res.UploadId, key };
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
      const { projectId, purchaseId, trackId } = await assertOwnsVersion(ctx, input.trackVersionId);

      const completedUpload = await getR2().send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          UploadId: input.uploadId,
          MultipartUpload: {
            Parts: input.parts.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.eTag,
            })),
          },
        }),
      );
      let completedHead: HeadObjectCommandOutput;
      try {
        completedHead = await getR2().send(
          new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: input.key }),
        );
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The completed audio object identity could not be verified.",
        });
      }
      const { objectEtag, sizeBytes: observedSizeBytes } = validateCompletedAudioObjectIdentity({
        claimedSizeBytes: input.sizeBytes,
        completedEtag: completedUpload.ETag,
        observedEtag: completedHead.ETag,
        observedSizeBytes: completedHead.ContentLength,
      });
      const audioIdentityFingerprint = createAudioIdentityFingerprint({
        key: input.key,
        objectEtag,
        sizeBytes: observedSizeBytes,
      });

      const url = publicUrl("audio", input.key);

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
          assertAvailableUploadPlaceholder(lockedVersion);

          const [updatedVersion] = await tx
            .update(trackVersions)
            .set({
              audioUrl: url,
              audioR2Key: input.key,
              sizeBytes: observedSizeBytes,
              audioObjectEtag: objectEtag,
              audioIdentityFingerprint,
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
