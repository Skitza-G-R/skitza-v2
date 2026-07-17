import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  inArray,
  isNull,
  projectTracks,
  projects,
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
import { producerProcedure } from "../producer-procedure";
import {
  cancelPendingMultipartUpload,
  PendingMultipartCancellationError,
} from "~/server/audio/pending-multipart-cancellation";
import { recordContact } from "~/server/contacts/record";
import {
  createPurchaseOwnedSongSpace,
  SongSpaceDomainError,
} from "~/server/domain/song-spaces/service";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
} from "~/server/domain/version-uploads/service";
import { assertWritableCommentTarget, CommentDomainError } from "~/server/domain/comments/service";
import { SITE_URL, sendProducerRepliedToCommentEmail } from "~/server/email/send";

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

function mapCommentDomainError(error: unknown): never {
  if (!(error instanceof CommentDomainError)) throw error;
  if (error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

type Stage = "lead" | "booked" | "in_production" | "final_review" | "paid" | "archived";

// ─── Inputs ──────────────────────────────────────────────────────────
// A manually created project is only a work container for a stable client.
// Commercial work begins at the accepted-purchase boundary.
const CreateProjectInput = z
  .object({
    title: z.string().min(1).max(120),
    artistName: z.string().min(1).max(80),
    artistEmail: z.string().email(),
    // ISO 8601 — parsed into a Date for the timestamptz column.
    deadlineAt: z.string().datetime().optional(),
  })
  .strict();

// Edit-project modal payload. All fields optional so the modal can
// PATCH only what the producer changed; at least one must be present
// for the procedure to do anything (no-op return otherwise).
const UpdateProjectInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  artistName: z.string().min(1).max(80).optional(),
  artistEmail: z.string().email().optional(),
});

const AddTrackInput = z.object({
  projectId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  title: z.string().min(1).max(120),
  artist: z.string().max(120).optional(),
});

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
          : r.lifecycleStatus === "completed"
            ? "paid"
            : r.lifecycleStatus === "canceled"
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
      const [row] = await ctx.db.select().from(projects).where(eq(projects.id, input.id)).limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tracksList = await ctx.db
        .select()
        .from(projectTracks)
        .where(eq(projectTracks.projectId, row.id))
        .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));
      // Advisory UI allocation only. The mutation locks and re-checks the
      // exact purchase capacity, so a concurrent upload still fails closed.
      const activePurchases =
        row.lifecycleStatus === "active"
          ? await ctx.db
              .select({
                id: purchases.id,
                acceptedAt: purchases.acceptedAt,
                commercialSnapshot: purchases.commercialSnapshot,
              })
              .from(purchases)
              .where(
                and(
                  eq(purchases.producerId, ctx.producerId),
                  eq(purchases.projectId, row.id),
                  eq(purchases.lifecycleStatus, "active"),
                ),
              )
              .orderBy(asc(purchases.acceptedAt), asc(purchases.id))
          : [];
      const songSpaceCounts = new Map<string, number>();
      for (const track of tracksList) {
        if (track.purchaseId) {
          songSpaceCounts.set(track.purchaseId, (songSpaceCounts.get(track.purchaseId) ?? 0) + 1);
        }
      }
      const eligibleSongSpacePurchase = activePurchases.find((purchase) => {
        const capacity = purchase.commercialSnapshot.includedSongSpaces;
        return Number.isSafeInteger(capacity) && capacity > (songSpaceCounts.get(purchase.id) ?? 0);
      });
      // Fetch all versions + comments with JS-side filter. Producers
      // with dozens of projects wouldn't win from a SQL inArray here
      // because the set of trackIds is already small (typically 1-5
      // tracks per project).
      const trackIds = tracksList.map((t) => t.id);
      const allVersions = trackIds.length
        ? (
            await ctx.db.select().from(trackVersions).orderBy(desc(trackVersions.uploadedAt))
          ).filter((v) => trackIds.includes(v.trackId))
        : [];
      const versionIds = allVersions.map((v) => v.id);
      const allComments = versionIds.length
        ? (
            await ctx.db.select().from(trackComments).orderBy(asc(trackComments.timestampMs))
          ).filter((c) => versionIds.includes(c.versionId))
        : [];
      return {
        project: stripHash(row),
        tracks: tracksList,
        versions: allVersions,
        comments: allComments,
        songSpacePurchaseId: eligibleSongSpacePurchase?.id ?? null,
      };
    }),

  create: producerProcedure.input(CreateProjectInput).mutation(async ({ ctx, input }) => {
    const clientContactId = await recordContact(ctx.db, {
      producerId: ctx.producerId,
      email: input.artistEmail,
      name: input.artistName,
    });
    if (!clientContactId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A stable client is required for every project.",
      });
    }
    const token = mintShareToken();
    const [row] = await ctx.db
      .insert(projects)
      .values({
        producerId: ctx.producerId,
        clientContactId,
        title: input.title,
        artistName: input.artistName,
        artistEmail: input.artistEmail.toLowerCase(),
        // Persist the raw token so the project-room landing page can
        // verify the URL the artist clicked. Unique constraint at the
        // schema level guards against guess collisions.
        inviteToken: token.raw,
        ...(input.deadlineAt ? { deadlineAt: new Date(input.deadlineAt) } : {}),
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    return { project: stripHash(row), inviteToken: token.raw };
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
        .where(eq(projects.id, input.projectId))
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
        .where(eq(projects.id, input.projectId));
      return { updatedAt };
    }),

  // Edit-project modal handler. Ownership-checked; only the fields
  // present in the input are written, so the modal can PATCH a single
  // field without nulling the others. No-op when nothing changed.
  update: producerProcedure.input(UpdateProjectInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ producerId: projects.producerId })
      .from(projects)
      .where(eq(projects.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });

    const updates: Partial<typeof projects.$inferInsert> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.artistName !== undefined) updates.artistName = input.artistName;
    if (input.artistEmail !== undefined) {
      updates.artistEmail = input.artistEmail.toLowerCase();
    }
    if (Object.keys(updates).length === 0) {
      return { ok: true as const };
    }
    updates.updatedAt = new Date();
    await ctx.db.update(projects).set(updates).where(eq(projects.id, input.id));
    return { ok: true as const };
  }),

  addTrack: producerProcedure.input(AddTrackInput).mutation(async ({ ctx, input }) => {
    let insertedRow: typeof projectTracks.$inferSelect | undefined;
    try {
      await createPurchaseOwnedSongSpace(
        {
          atomically: (_scope, work) =>
            ctx.db.transaction(async (tx) => {
              // Stable project -> purchase lock order prevents position races
              // and serializes the exact commercial allowance independently.
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`,
              );
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`,
              );
              return work({
                getActivePurchaseForUpdate: async (scope) => {
                  const [purchase] = await tx
                    .select({
                      id: purchases.id,
                      producerId: purchases.producerId,
                      projectId: purchases.projectId,
                      lifecycleStatus: purchases.lifecycleStatus,
                      projectLifecycleStatus: projects.lifecycleStatus,
                      commercialSnapshot: purchases.commercialSnapshot,
                    })
                    .from(purchases)
                    .innerJoin(
                      projects,
                      and(
                        eq(projects.id, purchases.projectId),
                        eq(projects.producerId, purchases.producerId),
                      ),
                    )
                    .where(
                      and(
                        eq(purchases.id, scope.purchaseId),
                        eq(purchases.projectId, scope.projectId),
                        eq(purchases.producerId, scope.producerId),
                        eq(purchases.lifecycleStatus, "active"),
                        eq(projects.lifecycleStatus, "active"),
                      ),
                    )
                    .limit(1)
                    .for("update");
                  return purchase
                    ? {
                        purchaseId: purchase.id,
                        producerId: purchase.producerId,
                        projectId: purchase.projectId,
                        lifecycleStatus: "active" as const,
                        projectLifecycleStatus: "active" as const,
                        includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
                      }
                    : null;
                },
                countPurchaseOwnedSongSpaces: async (scope) => {
                  const rows = await tx
                    .select({ id: projectTracks.id })
                    .from(projectTracks)
                    .where(
                      and(
                        eq(projectTracks.projectId, scope.projectId),
                        eq(projectTracks.purchaseId, scope.purchaseId),
                      ),
                    );
                  return rows.length;
                },
                nextProjectPositionForUpdate: async (scope) => {
                  const [last] = await tx
                    .select({ position: projectTracks.position })
                    .from(projectTracks)
                    .where(eq(projectTracks.projectId, scope.projectId))
                    .orderBy(desc(projectTracks.position))
                    .limit(1);
                  return (last?.position ?? -1) + 1;
                },
                insertSongSpace: async (songSpace) => {
                  const [row] = await tx
                    .insert(projectTracks)
                    .values({
                      projectId: songSpace.projectId,
                      purchaseId: songSpace.purchaseId,
                      title: songSpace.title,
                      ...(songSpace.artist ? { artist: songSpace.artist } : {}),
                      position: songSpace.position,
                    })
                    .returning();
                  if (!row) {
                    throw new SongSpaceDomainError(
                      "INTEGRITY_ERROR",
                      "Song-space insert returned no row",
                    );
                  }
                  insertedRow = row;
                  return {
                    id: row.id,
                    producerId: songSpace.producerId,
                    projectId: row.projectId,
                    purchaseId: row.purchaseId,
                    title: row.title,
                    artist: row.artist,
                    position: row.position,
                  };
                },
                touchProject: async (scope, changedAt) => {
                  await tx
                    .update(projects)
                    .set({ updatedAt: changedAt })
                    .where(
                      and(
                        eq(projects.id, scope.projectId),
                        eq(projects.producerId, scope.producerId),
                      ),
                    );
                },
              });
            }),
        },
        {
          producerId: ctx.producerId,
          projectId: input.projectId,
          purchaseId: input.purchaseId,
          title: input.title,
          ...(input.artist === undefined ? {} : { artist: input.artist }),
          createdAt: new Date(),
        },
      );
    } catch (error) {
      mapSongSpaceDomainError(error);
    }
    if (!insertedRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return insertedRow;
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
      const [track] = await ctx.db
        .select({
          id: projectTracks.id,
          projectId: projectTracks.projectId,
        })
        .from(projectTracks)
        .where(eq(projectTracks.id, input.trackId))
        .limit(1);
      if (!track) throw new TRPCError({ code: "NOT_FOUND" });

      const [project] = await ctx.db
        .select({ producerId: projects.producerId })
        .from(projects)
        .where(eq(projects.id, track.projectId))
        .limit(1);
      if (!project || project.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db
        .update(projectTracks)
        .set({ workflowStage: input.workflowStage })
        .where(eq(projectTracks.id, input.trackId));

      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, track.projectId));

      return { ok: true as const, workflowStage: input.workflowStage };
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
      const [proj] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.producerId, ctx.producerId)))
        .limit(1);
      if (!proj) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .update(projectTracks)
        .set({ title: input.title })
        .where(
          and(eq(projectTracks.id, input.trackId), eq(projectTracks.projectId, input.projectId)),
        );
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));
      return { ok: true as const };
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
      const [row] = await ctx.db
        .select({
          projectId: projectTracks.projectId,
          producerId: projects.producerId,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId || row.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(trackVersions)
        .set({ label: input.label })
        .where(eq(trackVersions.id, input.versionId));
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));
      return { ok: true as const };
    }),

  addVersion: producerProcedure.input(AddVersionInput).mutation(async ({ ctx, input }) => {
    const [discoveredTrack] = await ctx.db
      .select({
        id: projectTracks.id,
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
      })
      .from(projectTracks)
      .where(eq(projectTracks.id, input.trackId))
      .limit(1);
    if (!discoveredTrack?.purchaseId) throw new TRPCError({ code: "NOT_FOUND" });

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
          })
          .from(projectTracks)
          .where(eq(projectTracks.id, input.trackId))
          .limit(1)
          .for("update");

        assertActiveVersionUploadLifecycle(
          project && purchase && track
            ? {
                producerId: project.producerId,
                projectId: track.projectId,
                purchaseId: track.purchaseId,
                projectLifecycleStatus: project.lifecycleStatus,
                purchaseLifecycleStatus: purchase.lifecycleStatus,
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
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    await ctx.db
      .update(trackComments)
      .set({ resolvedAt: input.resolved ? new Date() : null })
      .where(eq(trackComments.id, input.id));
    return { ok: true as const };
  }),

  // Compatibility name: producer action records only producer-marked-final
  // state. Artist approval is a separate immutable versionApprovalEvents row.
  approveVersion: producerProcedure
    .input(z.object({ versionId: z.string().uuid(), approved: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const [v] = await ctx.db
        .select({
          trackId: trackVersions.trackId,
        })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      const [t] = await ctx.db
        .select({ projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const [d] = await ctx.db
        .select({ producerId: projects.producerId })
        .from(projects)
        .where(eq(projects.id, t.projectId))
        .limit(1);
      if (!d || d.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const nowOrNull = input.approved ? new Date() : null;
      await ctx.db
        .update(trackVersions)
        .set({ producerMarkedFinalAt: nowOrNull })
        .where(eq(trackVersions.id, input.versionId));

      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, t.projectId));

      return { ok: true as const, approvedAt: nowOrNull };
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
            .select({ id: trackVersions.id, trackId: trackVersions.trackId })
            .from(trackVersions)
            .where(eq(trackVersions.id, input.versionId))
            .limit(1)
            .for("update");

          if (!project || project.producerId !== ctx.producerId) {
            throw new TRPCError({ code: "FORBIDDEN" });
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
          };
        });
      } catch (error) {
        mapCommentDomainError(error);
      }
      const { row, project, track, producerName } = saved;

      after(async () => {
        try {
          await sendProducerRepliedToCommentEmail(project.artistEmail, {
            artistName: project.artistName,
            producerName,
            trackTitle: track.title,
            replyBody: input.body,
            threadUrl: `${SITE_URL}/artist/music`,
          });
        } catch (err) {
          console.error("[email] producer-replied-to-comment failed", err);
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
        .where(inArray(projects.id, input.orderedIds));
      if (rows.length !== input.orderedIds.length) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (rows.some((r) => r.producerId !== ctx.producerId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [idx, id] of input.orderedIds.entries()) {
          await tx.update(projects).set({ position: idx }).where(eq(projects.id, id));
        }
      });
      return { count: input.orderedIds.length };
    }),
});
