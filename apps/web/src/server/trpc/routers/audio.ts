import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  producers,
  projectTracks,
  projects,
  eq,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { computePeaksFromBytes } from "~/server/audio/peaks";
import {
  SITE_URL,
  sendTrackVersionUploadedEmail,
} from "~/server/email/send";
import { BUCKETS, buildAudioKey, getR2, publicUrl } from "~/server/storage/r2";

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
      message:
        "That's not an audio file we recognise. Try WAV, MP3, FLAC, M4A, or AIFF.",
    });
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
      const obj = await getR2().send(
        new GetObjectCommand({ Bucket: BUCKETS.audio, Key: key }),
      );
      if (!obj.Body) return null;
      const bytes = await obj.Body.transformToByteArray();
      return await computePeaksFromBytes(bytes);
    } catch (err) {
      console.warn(
        "[peaks] GetObject failed:",
        err instanceof Error ? err.message : String(err),
      );
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

// Ownership walk starting from a trackVersion id. Returns the projectId
// so callers can touch updatedAt. Throws NOT_FOUND / FORBIDDEN on any
// broken link.
async function assertOwnsVersion(
  ctx: { db: Db; producerId: string },
  trackVersionId: string,
): Promise<{ projectId: string }> {
  const [tv] = await ctx.db
    .select({ id: trackVersions.id, trackId: trackVersions.trackId })
    .from(trackVersions)
    .where(eq(trackVersions.id, trackVersionId))
    .limit(1);
  if (!tv) throw new TRPCError({ code: "NOT_FOUND" });
  const [pt] = await ctx.db
    .select({ projectId: projectTracks.projectId })
    .from(projectTracks)
    .where(eq(projectTracks.id, tv.trackId))
    .limit(1);
  if (!pt) throw new TRPCError({ code: "NOT_FOUND" });
  const [project] = await ctx.db
    .select({ producerId: projects.producerId })
    .from(projects)
    .where(eq(projects.id, pt.projectId))
    .limit(1);
  if (!project || project.producerId !== ctx.producerId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return { projectId: pt.projectId };
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
        sizeBytes: z.number().int().positive(),
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

  // Return a presigned URL for a single part (PUT). We don't re-walk
  // the ownership chain here — the key prefix check is sufficient
  // because buildAudioKey only ever generates producer-scoped keys, and
  // the producer in ctx is authenticated. Cheaper than a DB roundtrip
  // per part on a 50-part upload.
  signPart: producerProcedure
    .input(
      z.object({
        key: z.string(),
        uploadId: z.string(),
        partNumber: z.number().int().min(1).max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`producers/${ctx.producerId}/`)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
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
        parts: z
          .array(z.object({ partNumber: z.number().int(), eTag: z.string() }))
          .min(1),
        trackVersionId: z.string().uuid(),
        sizeBytes: z.number().int().positive(),
        durationMs: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`producers/${ctx.producerId}/`)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { projectId } = await assertOwnsVersion(ctx, input.trackVersionId);

      await getR2().send(
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

      const url = publicUrl("audio", input.key);

      // Pre-compute waveform peaks server-side so the L3 song page
      // renders the real envelope on first frame. Fetch the bytes back
      // from R2 via GetObject (S3 protocol, no CDN cache lag), decode
      // with audio-decode, RMS-reduce to 200 bars. Bounded with a
      // timeout because a malformed container could otherwise hang
      // the response. Failure here is non-fatal — we save peaks=null
      // and the client-side decode in Waveform50 picks up the slack.
      const peaks = await computeUploadPeaks(input.key);

      await ctx.db
        .update(trackVersions)
        .set({
          audioUrl: url,
          audioR2Key: input.key,
          sizeBytes: input.sizeBytes,
          peaks,
          ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        })
        .where(eq(trackVersions.id, input.trackVersionId));
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, projectId));

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
