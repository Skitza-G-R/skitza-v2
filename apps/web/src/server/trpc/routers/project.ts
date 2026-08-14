import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  clientContacts,
  inArray,
  isNull,
  projectTracks,
  projects,
  purchaseInstallments,
  purchases,
  sql,
  desc,
  eq,
  producers,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { producerProcedure } from "../producer-procedure";
import {
  cancelPendingMultipartUpload,
  PendingMultipartCancellationError,
} from "~/server/audio/pending-multipart-cancellation";
import { historicalDeletionRepository } from "~/server/domain/history-deletion/db";
import {
  canPermanentlyDeleteEmptyDraftProject,
  HistoricalDeletionDomainError,
  permanentlyDeleteEmptyDraftProject,
} from "~/server/domain/history-deletion/service";
import { projectLifecycleRepository } from "~/server/domain/project-lifecycle/db";
import {
  cancelProject as cancelProjectLifecycle,
  cancelProjectPurchase,
  completeProject,
  editProject,
  ProjectLifecycleDomainError,
  reopenProject,
} from "~/server/domain/project-lifecycle/service";
import { stableProjectRepository } from "~/server/domain/project-ownership/db";
import {
  createStableClientProject,
  ProjectOwnershipDomainError,
} from "~/server/domain/project-ownership/service";
import {
  createPurchaseOwnedSongSpace,
  summarizeProjectSongSpaces,
  SongSpaceDomainError,
} from "~/server/domain/song-spaces/service";
import { songSpaceRepository } from "~/server/domain/song-spaces/db";
import { noChargeProposalRepository } from "~/server/domain/song-spaces/no-charge-db";
import {
  acceptNoChargeSongSpaceProposal,
  createNoChargeSongSpaceProposal,
  previewNoChargeSongSpaceProposal,
} from "~/server/domain/song-spaces/no-charge";
import {
  configuredNoChargeProposalSecret,
  configuredNoChargeProposalVerificationSecrets,
} from "~/server/domain/song-spaces/no-charge-token";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
} from "~/server/domain/version-uploads/service";
import { currentTrackArtistApprovalAction } from "~/server/domain/version-uploads/db";
import {
  markSongReleased,
  renameSongVersion,
  setSongArchiveState,
  setSongWorkflowStage,
  tombstoneStoredAudioVersion,
  updateSongMetadata,
} from "~/server/domain/song-management/db";
import {
  reconcileExactStoredAudioDeletion,
  SongManagementDomainError,
} from "~/server/domain/song-management/service";
import { r2ExactAudioStoragePort } from "~/server/domain/song-management/storage";
import { SongDeletionError } from "~/server/domain/song-deletion/errors";
import { reconcilePrivateSongArtworkDeletion } from "~/server/domain/song-artwork/storage";
import {
  reconcileFirstVersionFinalDeletion,
  reconcileFirstVersionStagingDeletion,
} from "~/server/domain/first-version-uploads/storage";
import { reconcileLegacyPeaksDeletion } from "~/server/domain/song-deletion/storage";
import { assertWritableCommentTarget, CommentDomainError } from "~/server/domain/comments/service";
import { versionApprovalRepository } from "~/server/domain/version-approval/db";
import {
  markProducerVersionReady,
  reopenArtistApprovedSong,
  VersionApprovalDomainError,
} from "~/server/domain/version-approval/service";
import { SITE_URL, sendProducerRepliedToCommentEmail } from "~/server/email/send";
import { deliverPushToProjectArtist, deliverPushToVersionArtist } from "~/server/push/delivery";
import { emitArtistProducerCommentNotification } from "~/server/artist/notification-emitters";

// ─── Helpers ─────────────────────────────────────────────────────────

// Generate a fresh share token for project rooms. 32 bytes → 43
// base64url chars. Raw token shown to producer ONCE when created;
// only sha256(token) persisted.
function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

type ProjectPublic = typeof projects.$inferSelect;
function stripHash(row: typeof projects.$inferSelect): ProjectPublic {
  return row;
}

function mapSongSpaceDomainError(error: unknown): never {
  if (!(error instanceof SongSpaceDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "CAPACITY_EXCEEDED") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "INTEGRITY_ERROR") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function mapVersionUploadDomainError(error: unknown): never {
  if (!(error instanceof VersionUploadDomainError)) throw error;
  if (error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function mapPendingMultipartCancellationError(error: unknown): never {
  if (!(error instanceof PendingMultipartCancellationError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}

function mapSongDeletionError(error: unknown): never {
  if (!(error instanceof SongDeletionError)) throw error;
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error.code === "DELETE_SONG_REQUIRED" || error.code === "CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "INTEGRITY_ERROR") {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
}

function mapCommentDomainError(error: unknown): never {
  if (!(error instanceof CommentDomainError)) throw error;
  if (error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function mapSongManagementDomainError(error: unknown): never {
  if (!(error instanceof SongManagementDomainError)) throw error;
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error.code === "INVALID_INPUT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error.code === "AUDIO_PROTECTED") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  if (error.code === "STORAGE_IDENTITY_MISMATCH") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error.code === "OPERATION_KEY_CONFLICT") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}

function mapVersionApprovalDomainError(error: unknown): never {
  if (!(error instanceof VersionApprovalDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  if (error.code === "INVALID_INPUT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error.code === "NOT_READY" || error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  if (error.code === "LOCKED" || error.code === "CONCURRENT_CHANGE") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}

function mapProjectOwnershipDomainError(error: unknown): never {
  if (!(error instanceof ProjectOwnershipDomainError)) throw error;
  if (error.code === "CLIENT_ARCHIVED") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function mapHistoricalDeletionDomainError(error: unknown): never {
  if (!(error instanceof HistoricalDeletionDomainError)) throw error;
  if (error.code === "NOT_FOUND") throw new TRPCError({ code: "NOT_FOUND" });
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
}

function mapProjectLifecycleDomainError(error: unknown): never {
  if (!(error instanceof ProjectLifecycleDomainError)) throw error;
  if (error.code === "NOT_FOUND") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error.code === "INVALID_INPUT") {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error.code === "INVALID_TRANSITION") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  if (error.code === "CONCURRENT_CHANGE") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
}

type Stage = "lead" | "booked" | "in_production" | "final_review" | "paid" | "archived";

// ─── Inputs ──────────────────────────────────────────────────────────
// A manually created project is only a work container for a stable client.
// Commercial work begins at the accepted-purchase boundary.
const CreateProjectInput = z
  .object({
    title: z.string().min(1).max(120),
    clientContactId: z.string().uuid(),
    // ISO 8601 — parsed into a Date for the timestamptz column.
    deadlineAt: z.string().datetime().optional(),
  })
  .strict();

// Edit-project modal payload. All fields optional so the modal can
// PATCH only what the producer changed; at least one must be present
// for the procedure to do anything (no-op return otherwise).
const UpdateProjectInput = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(120).optional(),
    deadlineAt: z.string().datetime().nullable().optional(),
    workflowStage: z.enum(["brief", "production", "mixing", "mastering", "done"]).optional(),
  })
  .strict();

const AddTrackInput = z.object({
  projectId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  operationKey: z.string().trim().min(1).max(200),
  title: z.string().min(1).max(120),
  artist: z.string().max(120).optional(),
});

const CreateNoChargeProposalInput = z
  .object({
    projectId: z.string().uuid(),
    operationKey: z.string().trim().min(1).max(200),
    songTitle: z.string().trim().min(1).max(120),
  })
  .strict();

const PreviewNoChargeProposalInput = z
  .object({ proposalToken: z.string().min(1).max(4096) })
  .strict();

const AcceptNoChargeProposalInput = z
  .object({
    proposalToken: z.string().min(1).max(4096),
    expectedSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    agreementAccepted: z.literal(true),
  })
  .strict();

const AddVersionInput = z.object({
  trackId: z.string().uuid(),
  label: z.string().min(1).max(40),
  // addVersion creates only an upload placeholder. The authoritative R2
  // completion boundary supplies the URL and exact object identity together.
  audioUrl: z.null(),
  durationMs: z
    .number()
    .int()
    .min(1)
    .max(1000 * 60 * 60 * 3)
    .optional(), // cap 3h
  // Phase 4 (C2) — optional producer notes typed in the Upload Track
  // modal. Trimmed + capped to keep the textarea honest. Stored on
  // track_versions.description.
  description: z.string().trim().max(2000).optional(),
});

const ResolveCommentInput = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
});

// ─── Router ──────────────────────────────────────────────────────────
export const projectRouter = router({
  // ── Producer-side ───────────────────────────────────────────────
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .orderBy(desc(projects.updatedAt));
  }),

  // Returns rows grouped by stage for the Kanban board. Seven buckets
  // keyed by the project_stage enum; each bucket ordered by updatedAt
  // desc so the most-recently-touched project floats to the top of
  // its column.
  listByStage: producerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(eq(projects.producerId, ctx.producerId))
      .orderBy(desc(projects.updatedAt));

    // Narrow each row's stage to the Kanban-visible subset. Drizzle
    // returns the full enum as the static type, but we filter out the
    // two terminal stages below so the assertion is safe at runtime.
    type KanbanRow = Omit<(typeof rows)[number], "stage"> & { stage: Stage };
    const grouped: Record<Stage, KanbanRow[]> = {
      lead: [],
      booked: [],
      in_production: [],
      final_review: [],
      paid: [],
      archived: [],
    };
    for (const r of rows) {
      const stage: Stage =
        r.lifecycleStatus === "waiting_for_payment"
          ? "lead"
          : r.lifecycleStatus === "completed" || r.lifecycleStatus === "canceled"
            ? "archived"
            : "in_production";
      grouped[stage].push({ ...r, stage });
    }
    return grouped;
  }),

  // Returns the project + its full tracks/versions/comments tree.
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const detail = await ctx.db.transaction(
        async (tx) => {
          const [row] = await tx
            .select()
            .from(projects)
            .where(and(eq(projects.id, input.id), eq(projects.producerId, ctx.producerId)))
            .limit(1);
          if (!row || row.producerId !== ctx.producerId) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          const tracksList = await tx
            .select()
            .from(projectTracks)
            .where(eq(projectTracks.projectId, row.id))
            .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));
          const purchaseRows = await tx
            .select({
              id: purchases.id,
              sourceKind: purchases.sourceKind,
              refNumber: purchases.refNumber,
              lifecycleStatus: purchases.lifecycleStatus,
              totalCents: purchases.totalCents,
              currency: purchases.currency,
              acceptedAt: purchases.acceptedAt,
              canceledAt: purchases.canceledAt,
              commercialSnapshot: purchases.commercialSnapshot,
            })
            .from(purchases)
            .where(and(eq(purchases.producerId, ctx.producerId), eq(purchases.projectId, row.id)))
            .orderBy(asc(purchases.acceptedAt), asc(purchases.id));
          const songSpaces = summarizeProjectSongSpaces({
            producerId: ctx.producerId,
            projectId: row.id,
            purchases: purchaseRows.map((purchase) => ({
              producerId: ctx.producerId,
              projectId: row.id,
              purchaseId: purchase.id,
              lifecycleStatus: purchase.lifecycleStatus,
              includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
              acceptedAt: purchase.acceptedAt,
            })),
            tracks: tracksList.map((track) => ({
              id: track.id,
              producerId: ctx.producerId,
              projectId: track.projectId,
              purchaseId: track.purchaseId,
              title: track.title,
              artist: track.artist,
              position: track.position,
            })),
          });
          const purchaseIds = purchaseRows.map((purchase) => purchase.id);
          const installmentRows =
            purchaseIds.length > 0
              ? await tx
                  .select({
                    id: purchaseInstallments.id,
                    purchaseId: purchaseInstallments.purchaseId,
                    position: purchaseInstallments.position,
                    amountCents: purchaseInstallments.amountCents,
                    currency: purchaseInstallments.currency,
                    dueAt: purchaseInstallments.dueAt,
                    status: purchaseInstallments.status,
                  })
                  .from(purchaseInstallments)
                  .where(
                    and(
                      eq(purchaseInstallments.producerId, ctx.producerId),
                      inArray(purchaseInstallments.purchaseId, purchaseIds),
                    ),
                  )
                  .orderBy(asc(purchaseInstallments.position), asc(purchaseInstallments.id))
              : [];
          // Keep version and comment reads inside the already-authorized
          // project boundary. Tombstoned rows retain immutable storage
          // identity, so they must never be loaded across producer tenants
          // and filtered only in application memory.
          const trackIds = tracksList.map((track) => track.id);
          const allVersions = trackIds.length
            ? (
                await tx
                  .select()
                  .from(trackVersions)
                  .where(
                    and(
                      eq(trackVersions.producerId, ctx.producerId),
                      inArray(trackVersions.trackId, trackIds),
                    ),
                  )
                  .orderBy(desc(trackVersions.uploadedAt))
              ).map((version) => {
                const redactedVersion = {
                  ...version,
                  audioR2Key: null,
                  sizeBytes: null,
                  audioObjectEtag: null,
                  audioIdentityFingerprint: null,
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
                  peaksR2Key: null,
                };
                return version.audioDeletedAt === null
                  ? redactedVersion
                  : {
                      ...redactedVersion,
                      audioUrl: null,
                      durationMs: null,
                      peaks: null,
                    };
              })
            : [];
          const versionIds = allVersions.map((version) => version.id);
          const allComments = versionIds.length
            ? await tx
                .select()
                .from(trackComments)
                .where(inArray(trackComments.versionId, versionIds))
                .orderBy(asc(trackComments.timestampMs))
            : [];
          return {
            project: stripHash(row),
            tracks: tracksList,
            versions: allVersions,
            comments: allComments,
            // Compatibility for the upload modal while callers move to the full
            // projection. The exact virtual slot purchase remains authoritative.
            songSpacePurchaseId: songSpaces.emptySlots[0]?.purchaseId ?? null,
            songSpaces,
            purchases: purchaseRows.map((purchase) => ({
              ...purchase,
              installments: installmentRows.filter(
                (installment) => installment.purchaseId === purchase.id,
              ),
            })),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      const canPermanentlyDelete =
        detail.project.lifecycleStatus === "waiting_for_payment"
          ? await canPermanentlyDeleteEmptyDraftProject(historicalDeletionRepository(ctx.db), {
              producerId: ctx.producerId,
              projectId: detail.project.id,
            })
          : false;
      return {
        ...detail,
        canPermanentlyDelete,
      };
    }),

  create: producerProcedure.input(CreateProjectInput).mutation(async ({ ctx, input }) => {
    const token = mintShareToken();
    try {
      const row = await createStableClientProject(stableProjectRepository(ctx.db), {
        producerId: ctx.producerId,
        clientContactId: input.clientContactId,
        title: input.title,
        inviteToken: token.raw,
        deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null,
      });
      return { project: stripHash(row), inviteToken: token.raw };
    } catch (error) {
      mapProjectOwnershipDomainError(error);
    }
  }),

  // Producer-only private notes for the Project Room → Notes tab.
  // Free-text body, capped at 5000 chars; empty string is allowed
  // (acts as "clear the notes"). Ownership-scoped — the project must
  // belong to the calling producer or we return NOT_FOUND (no
  // enumeration leak). Bumps `updatedAt` and returns it so the UI
  // can render "Saved <relative>" without a refetch.
  updateNotes: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // Empty string is valid (clearing notes). Cap at 5000 chars —
        // soft warning at 4500 lives in the UI; hard reject here.
        notes: z.string().max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ producerId: projects.producerId })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.producerId, ctx.producerId)))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        // NOT_FOUND for both "missing" and "owned by someone else" so
        // a tampered id can't enumerate the project space.
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const updatedAt = new Date();
      await ctx.db
        .update(projects)
        .set({ notes: input.notes, updatedAt })
        .where(and(eq(projects.id, input.projectId), eq(projects.producerId, ctx.producerId)));
      return { updatedAt };
    }),

  // Project lifecycle commands remain thin; the domain service owns
  // transitions, graph locks, commercial side effects, and idempotency.
  update: producerProcedure.input(UpdateProjectInput).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db
      .select({ workflowStage: projects.workflowStage })
      .from(projects)
      .where(and(eq(projects.id, input.id), eq(projects.producerId, ctx.producerId)))
      .limit(1);
    let result;
    try {
      result = await editProject(projectLifecycleRepository(ctx.db), {
        producerId: ctx.producerId,
        projectId: input.id,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.deadlineAt === undefined
          ? {}
          : { deadlineAt: input.deadlineAt === null ? null : new Date(input.deadlineAt) }),
        ...(input.workflowStage === undefined ? {} : { workflowStage: input.workflowStage }),
        changedAt: new Date(),
      });
    } catch (error) {
      mapProjectLifecycleDomainError(error);
    }
    if (
      result.changed &&
      input.workflowStage !== undefined &&
      before?.workflowStage !== result.project.workflowStage
    ) {
      after(async () => {
        try {
          await deliverPushToProjectArtist(ctx.db, result.project.id, {
            category: "project_status",
            url: `/artist/music/${result.project.id}`,
          });
        } catch {
          // Push is best effort and must not expose delivery details.
        }
      });
    }
    return result;
  }),

  complete: producerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await completeProject(projectLifecycleRepository(ctx.db), {
          producerId: ctx.producerId,
          projectId: input.id,
          completedAt: new Date(),
        });
      } catch (error) {
        mapProjectLifecycleDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, result.project.id, {
              category: "project_status",
              url: `/artist/music/${result.project.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return result;
    }),

  cancel: producerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      let result;
      try {
        result = await cancelProjectLifecycle(projectLifecycleRepository(ctx.db), {
          producerId: ctx.producerId,
          projectId: input.id,
          actorId: ctx.userId,
          reason: "Project canceled",
          canceledAt: new Date(),
        });
      } catch (error) {
        mapProjectLifecycleDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, result.project.id, {
              category: "project_status",
              url: `/artist/music/${result.project.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return result;
    }),

  reopen: producerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await reopenProject(projectLifecycleRepository(ctx.db), {
          producerId: ctx.producerId,
          projectId: input.id,
          reopenedAt: new Date(),
        });
      } catch (error) {
        mapProjectLifecycleDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, result.project.id, {
              category: "project_status",
              url: `/artist/music/${result.project.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return result;
    }),

  cancelPurchase: producerProcedure
    .input(
      z
        .object({
          projectId: z.string().uuid(),
          purchaseId: z.string().uuid(),
          reason: z.string().trim().min(1).max(500),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      let result;
      try {
        result = await cancelProjectPurchase(projectLifecycleRepository(ctx.db), {
          producerId: ctx.producerId,
          projectId: input.projectId,
          purchaseId: input.purchaseId,
          actorId: ctx.userId,
          reason: input.reason,
          canceledAt: new Date(),
        });
      } catch (error) {
        mapProjectLifecycleDomainError(error);
      }
      if (result.changed) {
        after(async () => {
          try {
            await deliverPushToProjectArtist(ctx.db, result.project.id, {
              category: "purchase_status",
              url: `/artist/payments/${result.purchase.id}`,
            });
          } catch {
            // Push is best effort and must not expose delivery details.
          }
        });
      }
      return result;
    }),

  deleteEmptyDraft: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await permanentlyDeleteEmptyDraftProject(historicalDeletionRepository(ctx.db), {
          producerId: ctx.producerId,
          projectId: input.id,
        });
      } catch (error) {
        mapHistoricalDeletionDomainError(error);
      }
    }),

  addTrack: producerProcedure.input(AddTrackInput).mutation(async ({ ctx, input }) => {
    try {
      return await createPurchaseOwnedSongSpace(songSpaceRepository(ctx.db), {
        producerId: ctx.producerId,
        projectId: input.projectId,
        purchaseId: input.purchaseId,
        operationKey: input.operationKey,
        title: input.title,
        ...(input.artist === undefined ? {} : { artist: input.artist }),
        createdAt: new Date(),
      });
    } catch (error) {
      mapSongSpaceDomainError(error);
    }
  }),

  noChargeProposal: router({
    create: producerProcedure
      .input(CreateNoChargeProposalInput)
      .mutation(async ({ ctx, input }) => {
        try {
          return await createNoChargeSongSpaceProposal(noChargeProposalRepository(ctx.db), {
            producerId: ctx.producerId,
            projectId: input.projectId,
            operationKey: input.operationKey,
            songTitle: input.songTitle,
            signingSecret: configuredNoChargeProposalSecret(),
          });
        } catch (error) {
          mapSongSpaceDomainError(error);
        }
      }),

    preview: artistProcedure.input(PreviewNoChargeProposalInput).query(async ({ ctx, input }) => {
      try {
        return await previewNoChargeSongSpaceProposal(noChargeProposalRepository(ctx.db), {
          proposalToken: input.proposalToken,
          clerkUserId: ctx.clerkUserId,
          signingSecret: configuredNoChargeProposalVerificationSecrets(),
        });
      } catch (error) {
        mapSongSpaceDomainError(error);
      }
    }),

    accept: artistProcedure.input(AcceptNoChargeProposalInput).mutation(async ({ ctx, input }) => {
      try {
        return await acceptNoChargeSongSpaceProposal(noChargeProposalRepository(ctx.db), {
          proposalToken: input.proposalToken,
          clerkUserId: ctx.clerkUserId,
          signingSecret: configuredNoChargeProposalVerificationSecrets(),
          expectedSnapshotDigest: input.expectedSnapshotDigest,
          agreementAccepted: input.agreementAccepted,
          acceptedAt: new Date(),
        });
      } catch (error) {
        mapSongSpaceDomainError(error);
      }
    }),
  }),

  // Manual stage advance for a single track. Used by both the Upload
  // Track modal (when the producer opts to bump the stage on upload)
  // and the standalone ChangeStageMenu on Song Space. Ownership chain:
  // track → project → producer. NOT_FOUND if the track id is bogus;
  // FORBIDDEN if the producer doesn't own the parent project.
  setTrackStage: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        workflowStage: z.enum(["brief", "production", "mixing", "mastering", "done"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await setSongWorkflowStage(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          workflowStage: input.workflowStage,
          changedAt: new Date(),
        });
        return { ok: true as const, workflowStage: result.workflowStage };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  // Inline-edit a track title from the Project Room music sub-tab.
  // Ownership-scoped via the UPDATE's WHERE clause (id + projectId +
  // producerId chain) so a tampered trackId from another project
  // cannot land here.
  updateTrackTitle: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        trackId: z.string().uuid(),
        title: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const track = await updateSongMetadata(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          projectId: input.projectId,
          title: input.title,
          changedAt: new Date(),
        });
        return { ok: true as const, title: track.title };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  updateTrackArtist: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        artist: z.string().max(120).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const track = await updateSongMetadata(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          artist: input.artist,
          changedAt: new Date(),
        });
        return { ok: true as const, artist: track.artist };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  setTrackArchived: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        archived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await setSongArchiveState(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          intent: input.archived ? "archive" : "restore",
          changedAt: new Date(),
        });
        return {
          ok: true as const,
          changed: result.changed,
          archivedAt: result.track.archivedAt,
        };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  markTrackReleased: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        confirmation: z.literal("MARK_SONG_RELEASED"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await markSongReleased(ctx.db, {
          producerId: ctx.producerId,
          trackId: input.trackId,
          releasedAt: new Date(),
        });
        return { ok: true as const, ...result };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  // Inline-edit a version label. Ownership chain: version → track →
  // project → producer. We verify all three links so neither a foreign
  // versionId nor a foreign projectId can route through this mutation.
  updateVersionLabel: producerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        versionId: z.string().uuid(),
        label: z.string().min(1).max(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const version = await renameSongVersion(ctx.db, {
          producerId: ctx.producerId,
          versionId: input.versionId,
          projectId: input.projectId,
          label: input.label,
          changedAt: new Date(),
        });
        return { ok: true as const, label: version.label };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  addVersion: producerProcedure.input(AddVersionInput).mutation(async ({ ctx, input }) => {
    const [discoveredTrack] = await ctx.db
      .select({
        id: projectTracks.id,
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
      })
      .from(projectTracks)
      .innerJoin(
        projects,
        and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, ctx.producerId)),
      )
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, projectTracks.purchaseId),
          eq(purchases.projectId, projectTracks.projectId),
          eq(purchases.producerId, ctx.producerId),
        ),
      )
      .where(
        and(
          eq(projectTracks.id, input.trackId),
          eq(projects.producerId, ctx.producerId),
          eq(purchases.producerId, ctx.producerId),
        ),
      )
      .limit(1);
    if (!discoveredTrack) throw new TRPCError({ code: "NOT_FOUND" });

    let row: typeof trackVersions.$inferSelect | undefined;
    try {
      row = await ctx.db.transaction(async (tx) => {
        // Match the song-space lock order. The following row locks make
        // lifecycle changes serialize even when their caller does not use
        // these advisory locks.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${discoveredTrack.projectId}, 0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${discoveredTrack.purchaseId}, 0))`,
        );
        const [project] = await tx
          .select({
            id: projects.id,
            producerId: projects.producerId,
            lifecycleStatus: projects.lifecycleStatus,
          })
          .from(projects)
          .where(eq(projects.id, discoveredTrack.projectId))
          .limit(1)
          .for("update");
        const [purchase] = await tx
          .select({
            id: purchases.id,
            producerId: purchases.producerId,
            projectId: purchases.projectId,
            lifecycleStatus: purchases.lifecycleStatus,
          })
          .from(purchases)
          .where(eq(purchases.id, discoveredTrack.purchaseId))
          .limit(1)
          .for("update");
        const [track] = await tx
          .select({
            id: projectTracks.id,
            projectId: projectTracks.projectId,
            purchaseId: projectTracks.purchaseId,
            archivedAt: projectTracks.archivedAt,
          })
          .from(projectTracks)
          .where(eq(projectTracks.id, input.trackId))
          .limit(1)
          .for("update");

        const currentArtistApprovalAction = await currentTrackArtistApprovalAction(tx, {
          trackId: input.trackId,
          purchaseId: discoveredTrack.purchaseId,
          producerId: ctx.producerId,
        });

        assertActiveVersionUploadLifecycle(
          project && purchase && track
            ? {
                producerId: project.producerId,
                projectId: track.projectId,
                purchaseId: track.purchaseId,
                projectLifecycleStatus: project.lifecycleStatus,
                purchaseLifecycleStatus: purchase.lifecycleStatus,
                trackArchivedAt: track.archivedAt,
                currentArtistApprovalAction,
              }
            : null,
          {
            producerId: ctx.producerId,
            projectId: discoveredTrack.projectId,
            purchaseId: discoveredTrack.purchaseId,
          },
        );
        if (
          purchase?.producerId !== ctx.producerId ||
          purchase.projectId !== discoveredTrack.projectId ||
          track?.projectId !== discoveredTrack.projectId ||
          track.purchaseId !== discoveredTrack.purchaseId
        ) {
          throw new VersionUploadDomainError(
            "NOT_FOUND",
            "The purchase-owned track binding was not found",
          );
        }

        const [inserted] = await tx
          .insert(trackVersions)
          .values({
            trackId: input.trackId,
            purchaseId: discoveredTrack.purchaseId,
            producerId: ctx.producerId,
            label: input.label,
            audioUrl: null,
            ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
            ...(input.description && input.description.length > 0
              ? { description: input.description }
              : {}),
          })
          .returning();
        if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await tx
          .update(projects)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, discoveredTrack.projectId),
              eq(projects.producerId, ctx.producerId),
            ),
          );
        return inserted;
      });
    } catch (error) {
      mapVersionUploadDomainError(error);
    }
    // NOTE: artist email moved to audio.completeMultipart (C1). When the
    // modal creates this row with audioUrl=null and patches the URL after
    // R2 completion, sending the email here would point the artist at a
    // missing file.

    return row;
  }),

  // Mark an incomplete track_versions upload as deleted when multipart
  // upload fails. Purchase-owned version history is immutable, so this
  // compatibility mutation never removes the row and refuses completed
  // audio. The modal's catch branch can still fire it best-effort.
  //
  // Ownership chain: version -> track -> project -> producer. Same shape
  // as updateVersionLabel. NOT_FOUND for both missing and foreign rows
  // so a tampered id can't enumerate the track_versions space.
  deleteVersion: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          projectId: projectTracks.projectId,
          producerId: projects.producerId,
          audioUrl: trackVersions.audioUrl,
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
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(
          projects,
          and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, ctx.producerId)),
        )
        .where(and(eq(trackVersions.id, input.id), eq(trackVersions.producerId, ctx.producerId)))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (
        row.pendingAudioR2Key !== null ||
        row.pendingAudioUploadId !== null ||
        row.pendingAudioInitiationDigest !== null ||
        row.pendingAudioCompletionToken !== null ||
        row.pendingAudioSizeBytes !== null ||
        row.pendingAudioStartedAt !== null ||
        row.pendingAudioCreateAttemptedAt !== null ||
        row.pendingAudioCompleteAttemptedAt !== null ||
        row.pendingAudioCompleteWriteOnceProtectedAt !== null ||
        row.pendingAudioPartUrlsExpireAt !== null ||
        row.pendingAudioCancelRequestedAt !== null ||
        row.pendingAudioCleanupEtag !== null
      ) {
        try {
          const cancellation = await cancelPendingMultipartUpload(ctx, {
            trackVersionId: input.id,
          });
          if (cancellation.kind !== "no_pending") return { ok: true as const };
        } catch (error) {
          mapPendingMultipartCancellationError(error);
        }
      }
      if (row.audioDeletedAt) return { ok: true as const };
      if (row.audioUrl !== null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only an incomplete upload can be cleaned up from this path.",
        });
      }
      const audioDeletedAt = new Date();
      const [softDeleted] = await ctx.db
        .update(trackVersions)
        .set({ audioDeletedAt })
        .where(
          and(
            eq(trackVersions.id, input.id),
            eq(trackVersions.producerId, ctx.producerId),
            isNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
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
      if (!softDeleted) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The upload changed while cleanup was in progress.",
        });
      }
      await ctx.db
        .update(projects)
        .set({ updatedAt: audioDeletedAt })
        .where(and(eq(projects.id, row.projectId), eq(projects.producerId, ctx.producerId)));
      return { ok: true as const };
    }),

  permanentlyDeleteVersionAudio: producerProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        operationKey: z.string().uuid(),
        confirmation: z.literal("DELETE_STORED_AUDIO"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        // Commit the tombstone, playback fallback, portfolio retarget, and
        // public-link consequence first. From this point every application
        // read is revoked even if the exact R2 reconciliation must be retried.
        const deletion = await tombstoneStoredAudioVersion(ctx.db, {
          producerId: ctx.producerId,
          versionId: input.versionId,
          deletedAt: new Date(),
          actorClerkUserId: ctx.userId,
          operationKey: input.operationKey,
        });
        const storage = await reconcileExactStoredAudioDeletion(
          r2ExactAudioStoragePort(),
          deletion.identity,
        );
        await ctx.db
          .update(trackVersions)
          .set({ audioStorageDeletedAt: new Date() })
          .where(
            and(
              eq(trackVersions.id, deletion.versionId),
              eq(trackVersions.producerId, ctx.producerId),
              isNull(trackVersions.audioStorageDeletedAt),
            ),
          );
        return {
          ok: true as const,
          storage: storage.kind,
          alreadyTombstoned: deletion.alreadyTombstoned,
          nextPlaybackVersionId: deletion.nextPlaybackVersionId,
          removedPortfolioEntry: deletion.wasLastStoredAudio,
          disabledPublicLink: deletion.wasLastStoredAudio,
        };
      } catch (error) {
        mapSongManagementDomainError(error);
      }
    }),

  permanentlyDeleteSongVersion: producerProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        operationKey: z.string().uuid(),
        confirmation: z.literal("DELETE_VERSION"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        const { permanentlyDeleteSongVersion } =
          await import("~/server/domain/song-deletion/service");
        return await permanentlyDeleteSongVersion(
          ctx.db,
          {
            audio: r2ExactAudioStoragePort(),
            reconcileArtworkDeletion: reconcilePrivateSongArtworkDeletion,
            reconcileFirstVersionFinalDeletion,
            reconcileFirstVersionStagingDeletion,
            reconcilePeaksDeletion: reconcileLegacyPeaksDeletion,
          },
          {
            producerId: ctx.producerId,
            actorClerkUserId: ctx.userId,
            operationKey: input.operationKey,
            versionId: input.versionId,
          },
        );
      } catch (error) {
        mapSongDeletionError(error);
      }
    }),

  permanentlyDeleteSong: producerProcedure
    .input(
      z.object({
        trackId: z.string().uuid(),
        operationKey: z.string().uuid(),
        confirmation: z.literal("DELETE_SONG"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
        const { permanentlyDeleteSong: permanentlyDeleteSongHistory } =
          await import("~/server/domain/song-deletion/service");
        return await permanentlyDeleteSongHistory(
          ctx.db,
          {
            audio: r2ExactAudioStoragePort(),
            reconcileArtworkDeletion: reconcilePrivateSongArtworkDeletion,
            reconcileFirstVersionFinalDeletion,
            reconcileFirstVersionStagingDeletion,
            reconcilePeaksDeletion: reconcileLegacyPeaksDeletion,
          },
          {
            producerId: ctx.producerId,
            actorClerkUserId: ctx.userId,
            operationKey: input.operationKey,
            trackId: input.trackId,
          },
        );
      } catch (error) {
        mapSongDeletionError(error);
      }
    }),

  resolveComment: producerProcedure.input(ResolveCommentInput).mutation(async ({ ctx, input }) => {
    const [c] = await ctx.db
      .select({ id: trackComments.id, versionId: trackComments.versionId })
      .from(trackComments)
      .where(eq(trackComments.id, input.id))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    const [v] = await ctx.db
      .select({ trackId: trackVersions.trackId })
      .from(trackVersions)
      .where(eq(trackVersions.id, c.versionId))
      .limit(1);
    if (!v) throw new TRPCError({ code: "NOT_FOUND" });
    const [t] = await ctx.db
      .select({ projectId: projectTracks.projectId })
      .from(projectTracks)
      .where(eq(projectTracks.id, v.trackId))
      .limit(1);
    if (!t) throw new TRPCError({ code: "NOT_FOUND" });
    const [p] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, t.projectId))
      .limit(1);
    if (!p || p.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    await ctx.db
      .update(trackComments)
      .set({ resolvedAt: input.resolved ? new Date() : null })
      .where(eq(trackComments.id, input.id));
    return { ok: true as const };
  }),

  markVersionReady: producerProcedure
    .input(z.object({ versionId: z.string().uuid(), ready: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await markProducerVersionReady(versionApprovalRepository(ctx.db), {
          producerId: ctx.producerId,
          versionId: input.versionId,
          ready: input.ready,
          changedAt: new Date(),
        });
        if (result.changed && input.ready) {
          after(async () => {
            try {
              await deliverPushToVersionArtist(ctx.db, input.versionId, {
                category: "song_status",
                url: `/artist/music/song/${input.versionId}`,
              });
            } catch {
              // Push is best effort and must not expose delivery details.
            }
          });
        }
        return { ok: true as const, markedFinalAt: result.markedFinalAt, changed: result.changed };
      } catch (error) {
        mapVersionApprovalDomainError(error);
      }
    }),

  reopenApprovedSong: producerProcedure
    .input(z.object({ trackId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      try {
        return await reopenArtistApprovedSong(versionApprovalRepository(ctx.db), {
          producerId: ctx.producerId,
          actorClerkUserId: ctx.userId,
          trackId: input.trackId,
          reopenedAt: new Date(),
        });
      } catch (error) {
        mapVersionApprovalDomainError(error);
      }
    }),

  // Producer-side comment (responds to artist).
  addProducerComment: producerProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        body: z.string().min(1).max(2000),
        timestampMs: z
          .number()
          .int()
          .min(0)
          .max(1000 * 60 * 60 * 3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [discovered] = await ctx.db
        .select({
          versionId: trackVersions.id,
          trackId: projectTracks.id,
          projectId: projects.id,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!discovered) throw new TRPCError({ code: "NOT_FOUND" });

      let saved: {
        row: typeof trackComments.$inferSelect;
        project: Pick<typeof projects.$inferSelect, "artistName" | "artistEmail">;
        track: Pick<typeof projectTracks.$inferSelect, "title">;
        producerName: string;
        artistClerkUserId: string | null;
      };
      try {
        saved = await ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${discovered.projectId}, 0))`,
          );
          const [project] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
              artistName: projects.artistName,
              artistEmail: projects.artistEmail,
              clientContactId: projects.clientContactId,
            })
            .from(projects)
            .where(eq(projects.id, discovered.projectId))
            .limit(1)
            .for("update");
          const [track] = await tx
            .select({
              id: projectTracks.id,
              projectId: projectTracks.projectId,
              title: projectTracks.title,
              archivedAt: projectTracks.archivedAt,
            })
            .from(projectTracks)
            .where(eq(projectTracks.id, discovered.trackId))
            .limit(1)
            .for("update");
          const [version] = await tx
            .select({
              id: trackVersions.id,
              trackId: trackVersions.trackId,
              audioDeletedAt: trackVersions.audioDeletedAt,
            })
            .from(trackVersions)
            .where(eq(trackVersions.id, input.versionId))
            .limit(1)
            .for("update");

          if (!project || project.producerId !== ctx.producerId) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          if (!track || !version) {
            throw new CommentDomainError("NOT_FOUND", "The comment target was not found");
          }
          assertWritableCommentTarget(
            {
              versionId: version.id,
              versionTrackId: version.trackId,
              trackId: track.id,
              trackProjectId: track.projectId,
              trackArchivedAt: track.archivedAt,
              versionAudioDeletedAt: version.audioDeletedAt,
              projectId: project.id,
              projectLifecycleStatus: project.lifecycleStatus,
            },
            {
              versionId: input.versionId,
              trackId: discovered.trackId,
              projectId: discovered.projectId,
            },
          );

          const [producerRow] = await tx
            .select({ displayName: producers.displayName })
            .from(producers)
            .where(eq(producers.id, ctx.producerId))
            .limit(1);
          const [artistContact] = await tx
            .select({ clerkUserId: clientContacts.clerkUserId })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.id, project.clientContactId),
                eq(clientContacts.producerId, project.producerId),
                isNull(clientContacts.archivedAt),
              ),
            )
            .limit(1);
          const producerName = producerRow?.displayName ?? "Producer";
          const [row] = await tx
            .insert(trackComments)
            .values({
              versionId: input.versionId,
              producerId: ctx.producerId,
              authorName: producerName,
              authorEmail: project.artistEmail,
              body: input.body,
              timestampMs: input.timestampMs,
              fromProducer: true,
            })
            .returning();
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return {
            row,
            project: { artistName: project.artistName, artistEmail: project.artistEmail },
            track: { title: track.title },
            producerName,
            artistClerkUserId: artistContact?.clerkUserId ?? null,
          };
        });
      } catch (error) {
        mapCommentDomainError(error);
      }
      const { row, project, track, producerName, artistClerkUserId } = saved;

      after(async () => {
        let emailEnabled = false;
        try {
          const delivery = await emitArtistProducerCommentNotification(ctx.db, {
            recipientClerkUserId: artistClerkUserId,
            producerId: ctx.producerId,
            trackVersionId: input.versionId,
            commentId: row.id,
            producerName,
            trackTitle: track.title,
          });
          emailEnabled = delivery.emailEnabled;
        } catch (error) {
          console.warn("[artist-notify] producer comment failed", error);
        }
        if (!emailEnabled) return;
        try {
          await sendProducerRepliedToCommentEmail(project.artistEmail, {
            artistName: project.artistName,
            producerName,
            trackTitle: track.title,
            replyBody: input.body,
            threadUrl: `${SITE_URL}/artist/music/song/${input.versionId}?comment=${row.id}`,
          });
        } catch (err) {
          console.error("[email] producer-replied-to-comment failed", err);
        }
      });
      after(async () => {
        try {
          await deliverPushToVersionArtist(ctx.db, input.versionId, {
            category: "comment",
            url: `/artist/music/song/${input.versionId}?comment=${row.id}`,
          });
        } catch {
          // Push is best effort and must not expose delivery details.
        }
      });

      return row;
    }),

  // Sessions now point at an existing purchase-owned project. This legacy
  // helper only resolves that project and never forks a second row.
  createFromBooking: producerProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [booking] = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!booking || booking.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const [existing] = await ctx.db
        .select()
        .from(projects)
        .where(and(eq(projects.producerId, ctx.producerId), eq(projects.id, booking.projectId)))
        .limit(1);
      if (existing) {
        return { project: stripHash(existing), shareToken: null, existing: true };
      }
      throw new TRPCError({ code: "NOT_FOUND" });
    }),

  // Clients & Projects v3 redesign — Phase 1 Task 15. Drag-to-reorder
  // for the Projects list. Writes the new ordinals (position == index
  // in orderedIds) inside a single ctx.db.transaction so a partial
  // failure can't leave the list half-reordered. Ownership verified by
  // selecting all matching producerIds in one query before any write.
  // Idempotent: calling with the same order is a no-op DB write.
  // Mirrors the precedents in booking.products.reorder and
  // clientContacts.reorder.
  reorder: producerProcedure
    .input(
      z.object({
        orderedIds: z
          .array(z.string().uuid())
          .min(1)
          .refine((arr) => new Set(arr).size === arr.length, "duplicate ids are not allowed"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: projects.id, producerId: projects.producerId })
        .from(projects)
        .where(
          and(inArray(projects.id, input.orderedIds), eq(projects.producerId, ctx.producerId)),
        );
      if (rows.length !== input.orderedIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (rows.some((r) => r.producerId !== ctx.producerId)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx
            .update(projects)
            .set({ position: idx })
            .where(and(eq(projects.id, id), eq(projects.producerId, ctx.producerId)));
        }
      });
      return { count: input.orderedIds.length };
    }),
});
