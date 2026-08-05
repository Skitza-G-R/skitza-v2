import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import {
  and,
  asc,
  clientContacts,
  eq,
  firstVersionUploadIntents,
  isNull,
  ne,
  producers,
  projectTracks,
  projects,
  purchases,
  sql,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import {
  FirstVersionUploadError,
  assertFirstVersionAudioFile,
  assertFirstVersionUploadDestination,
  createFirstVersionRequestDigest,
  createStoredAudioIdentityFingerprint,
  presignFirstVersionUploadWithCompensation,
} from "~/server/domain/first-version-uploads/service";
import {
  FirstVersionUploadPresignError,
  buildFirstVersionStagingKey,
  computeFirstVersionUploadPeaks,
  createFirstVersionUploadUrl,
  deleteFirstVersionUploadIfExact,
  finalizeFirstVersionUpload,
} from "~/server/domain/first-version-uploads/storage";
import { emitArtistNewVersionNotification } from "~/server/artist/notification-emitters";
import { SITE_URL, sendTrackVersionUploadedEmail } from "~/server/email/send";
import { buildAudioKey } from "~/server/storage/r2";

const INTENT_TTL_MS = 24 * 60 * 60 * 1_000;

const prepareInput = z.object({
  operationKey: z.string().min(16).max(200),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, "Song title is required").max(120),
  artist: z.string().trim().min(1).max(120).nullish(),
  label: z.string().trim().min(1, "Version label is required").max(40),
  description: z.string().trim().min(1).max(500).nullish(),
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentType: z.string().trim().min(1).max(120),
  durationMs: z.number().int().positive().max(86_400_000).nullish(),
});

function mapFirstVersionUploadError(error: unknown): never {
  if (error instanceof FirstVersionUploadPresignError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (!(error instanceof FirstVersionUploadError)) throw error;
  switch (error.code) {
    case "BAD_REQUEST":
    case "MISMATCH":
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    case "NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    case "INACTIVE":
    case "CONFLICT":
    case "CANCELED":
    case "EXPIRED":
      throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
}

function assertIntentCanUpload(
  intent: {
    requestDigest: string;
    completedAt: Date | null;
    canceledAt: Date | null;
    expiresAt: Date;
  },
  requestDigest: string,
): void {
  if (intent.requestDigest !== requestDigest) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This upload retry contains different Song or file details",
    );
  }
  if (intent.canceledAt) {
    throw new FirstVersionUploadError(
      "CANCELED",
      "This upload was canceled. Choose the file again.",
    );
  }
  if (!intent.completedAt && intent.expiresAt.getTime() <= Date.now()) {
    throw new FirstVersionUploadError("EXPIRED", "This upload expired. Choose the file again.");
  }
}

async function cleanIntentObjects(intent: {
  stagingAudioR2Key: string;
  audioR2Key: string;
  audioSizeBytes: number;
  audioContentType: string;
  completionToken: string;
}): Promise<void> {
  const common = {
    sizeBytes: intent.audioSizeBytes,
    contentType: intent.audioContentType,
    completionToken: intent.completionToken,
  };
  await Promise.allSettled([
    deleteFirstVersionUploadIfExact({ key: intent.stagingAudioR2Key, ...common }),
    deleteFirstVersionUploadIfExact({ key: intent.audioR2Key, ...common }),
  ]);
}

export const firstVersionUploadRouter = router({
  prepare: producerProcedure.input(prepareInput).mutation(async ({ ctx, input }) => {
    try {
      assertFirstVersionAudioFile(input);
      const normalized = {
        ...input,
        contentType: input.contentType.toLowerCase(),
        artist: input.artist ?? null,
        description: input.description ?? null,
        durationMs: input.durationMs ?? null,
      };
      const requestDigest = createFirstVersionRequestDigest(normalized);

      const [existing] = await ctx.db
        .select()
        .from(firstVersionUploadIntents)
        .where(
          and(
            eq(firstVersionUploadIntents.producerId, ctx.producerId),
            eq(firstVersionUploadIntents.operationKey, input.operationKey),
          ),
        )
        .limit(1);
      if (existing) {
        assertIntentCanUpload(existing, requestDigest);
        if (existing.completedAt) {
          return {
            status: "completed" as const,
            intentId: existing.id,
            projectId: existing.projectId,
            trackId: existing.trackId,
            versionId: existing.versionId,
          };
        }
      }

      const destinationRows = await ctx.db
        .select({
          producerId: projects.producerId,
          projectId: projects.id,
          purchaseId: purchases.id,
          projectProducerId: projects.producerId,
          projectLifecycleStatus: projects.lifecycleStatus,
          purchaseProducerId: purchases.producerId,
          purchaseProjectId: purchases.projectId,
          purchaseLifecycleStatus: purchases.lifecycleStatus,
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(projects)
        .innerJoin(
          purchases,
          and(eq(purchases.projectId, projects.id), eq(purchases.producerId, projects.producerId)),
        )
        .where(and(eq(projects.id, input.projectId), eq(projects.producerId, ctx.producerId)))
        .orderBy(asc(purchases.acceptedAt), asc(purchases.id));
      const allocatedRows = await ctx.db
        .select({ purchaseId: projectTracks.purchaseId })
        .from(projectTracks)
        .where(eq(projectTracks.projectId, input.projectId));
      const allocatedByPurchase = new Map<string, number>();
      for (const row of allocatedRows) {
        allocatedByPurchase.set(row.purchaseId, (allocatedByPurchase.get(row.purchaseId) ?? 0) + 1);
      }
      const destinations = destinationRows.map((row) => ({
        ...row,
        includedSongSpaces: row.commercialSnapshot.includedSongSpaces,
        allocatedSongSpaces: allocatedByPurchase.get(row.purchaseId) ?? 0,
      }));
      const destination =
        (existing
          ? destinations.find((candidate) => candidate.purchaseId === existing.purchaseId)
          : (destinations.find(
              (candidate) =>
                candidate.projectLifecycleStatus === "active" &&
                candidate.purchaseLifecycleStatus === "active" &&
                Number.isSafeInteger(candidate.includedSongSpaces) &&
                candidate.allocatedSongSpaces < candidate.includedSongSpaces,
            ) ??
            destinations.find(
              (candidate) =>
                candidate.projectLifecycleStatus === "active" &&
                candidate.purchaseLifecycleStatus === "active",
            ))) ?? destinations[0];
      const activeDestination = assertFirstVersionUploadDestination(destination ?? null, {
        producerId: ctx.producerId,
        projectId: input.projectId,
      });

      if (existing) {
        const capability = await createFirstVersionUploadUrl({
          key: existing.stagingAudioR2Key,
          sizeBytes: existing.audioSizeBytes,
          contentType: existing.audioContentType,
          completionToken: existing.completionToken,
        });
        return {
          status: "ready" as const,
          intentId: existing.id,
          projectId: existing.projectId,
          trackId: existing.trackId,
          versionId: existing.versionId,
          ...capability,
        };
      }

      const intentId = randomUUID();
      const trackId = randomUUID();
      const versionId = randomUUID();
      const completionToken = randomBytes(32).toString("hex");
      const stagingAudioR2Key = buildFirstVersionStagingKey({
        producerId: ctx.producerId,
        intentId,
      });
      const audioR2Key = buildAudioKey({
        producerId: ctx.producerId,
        trackVersionId: versionId,
        filename: input.filename,
      });
      const now = new Date();
      const [inserted] = await ctx.db
        .insert(firstVersionUploadIntents)
        .values({
          id: intentId,
          producerId: ctx.producerId,
          projectId: input.projectId,
          purchaseId: activeDestination.purchaseId,
          operationKey: input.operationKey,
          requestDigest,
          trackId,
          versionId,
          title: input.title,
          artist: normalized.artist,
          label: input.label,
          description: normalized.description,
          stagingAudioR2Key,
          audioR2Key,
          audioContentType: normalized.contentType,
          audioSizeBytes: input.sizeBytes,
          durationMs: normalized.durationMs,
          completionToken,
          expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      const intent =
        inserted ??
        (
          await ctx.db
            .select()
            .from(firstVersionUploadIntents)
            .where(
              and(
                eq(firstVersionUploadIntents.producerId, ctx.producerId),
                eq(firstVersionUploadIntents.operationKey, input.operationKey),
              ),
            )
            .limit(1)
        )[0];
      if (!intent) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Upload could not start" });
      }
      assertIntentCanUpload(intent, requestDigest);
      if (!inserted) {
        assertFirstVersionUploadDestination(
          destinations.find((candidate) => candidate.purchaseId === intent.purchaseId) ?? null,
          { producerId: ctx.producerId, projectId: input.projectId },
        );
      }
      const capability = await presignFirstVersionUploadWithCompensation({
        newlyInserted: Boolean(inserted),
        presign: () =>
          createFirstVersionUploadUrl({
            key: intent.stagingAudioR2Key,
            sizeBytes: intent.audioSizeBytes,
            contentType: intent.audioContentType,
            completionToken: intent.completionToken,
          }),
        compensate: async () => {
          await ctx.db
            .delete(firstVersionUploadIntents)
            .where(
              and(
                eq(firstVersionUploadIntents.id, intent.id),
                eq(firstVersionUploadIntents.producerId, ctx.producerId),
                isNull(firstVersionUploadIntents.completedAt),
                isNull(firstVersionUploadIntents.canceledAt),
              ),
            );
        },
      });
      return {
        status: "ready" as const,
        intentId: intent.id,
        projectId: intent.projectId,
        trackId: intent.trackId,
        versionId: intent.versionId,
        ...capability,
      };
    } catch (error) {
      mapFirstVersionUploadError(error);
    }
  }),

  complete: producerProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [intent] = await ctx.db
        .select()
        .from(firstVersionUploadIntents)
        .where(
          and(
            eq(firstVersionUploadIntents.id, input.intentId),
            eq(firstVersionUploadIntents.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!intent) throw new TRPCError({ code: "NOT_FOUND" });
      if (intent.completedAt) {
        return {
          projectId: intent.projectId,
          trackId: intent.trackId,
          versionId: intent.versionId,
          url: privateVersionStreamPath(intent.versionId),
        };
      }
      try {
        assertIntentCanUpload(intent, intent.requestDigest);
        const stored = await finalizeFirstVersionUpload({
          stagingKey: intent.stagingAudioR2Key,
          finalKey: intent.audioR2Key,
          sizeBytes: intent.audioSizeBytes,
          contentType: intent.audioContentType,
          completionToken: intent.completionToken,
        });
        const peaks = await computeFirstVersionUploadPeaks(intent.audioR2Key);
        const audioIdentityFingerprint = createStoredAudioIdentityFingerprint({
          key: intent.audioR2Key,
          objectEtag: stored.objectEtag,
          sizeBytes: stored.sizeBytes,
        });
        const url = privateVersionStreamPath(intent.versionId);

        const completed = await ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${intent.projectId}, 0))`,
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${intent.purchaseId}, 0))`,
          );
          const [lockedIntent] = await tx
            .select()
            .from(firstVersionUploadIntents)
            .where(
              and(
                eq(firstVersionUploadIntents.id, intent.id),
                eq(firstVersionUploadIntents.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          if (!lockedIntent) {
            throw new FirstVersionUploadError("NOT_FOUND", "The upload intent was not found");
          }
          if (lockedIntent.completedAt) {
            return {
              projectId: lockedIntent.projectId,
              trackId: lockedIntent.trackId,
              newlyCompleted: false,
            };
          }
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(eq(projects.id, intent.projectId))
            .limit(1)
            .for("update");
          const [lockedPurchase] = await tx
            .select({
              id: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              lifecycleStatus: purchases.lifecycleStatus,
              commercialSnapshot: purchases.commercialSnapshot,
            })
            .from(purchases)
            .where(eq(purchases.id, intent.purchaseId))
            .limit(1)
            .for("update");
          const allocatedRows = await tx
            .select({ id: projectTracks.id })
            .from(projectTracks)
            .where(
              and(
                eq(projectTracks.projectId, intent.projectId),
                eq(projectTracks.purchaseId, intent.purchaseId),
                ne(projectTracks.id, intent.trackId),
              ),
            );
          assertFirstVersionUploadDestination(
            lockedProject && lockedPurchase
              ? {
                  producerId: lockedIntent.producerId,
                  projectId: lockedIntent.projectId,
                  purchaseId: lockedIntent.purchaseId,
                  projectProducerId: lockedProject.producerId,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseProducerId: lockedPurchase.producerId,
                  purchaseProjectId: lockedPurchase.projectId,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                  includedSongSpaces: lockedPurchase.commercialSnapshot.includedSongSpaces,
                  allocatedSongSpaces: allocatedRows.length,
                }
              : null,
            { producerId: ctx.producerId, projectId: intent.projectId },
          );
          assertIntentCanUpload(lockedIntent, intent.requestDigest);
          if (
            lockedIntent.purchaseId !== intent.purchaseId ||
            lockedIntent.trackId !== intent.trackId ||
            lockedIntent.versionId !== intent.versionId ||
            lockedIntent.audioR2Key !== intent.audioR2Key ||
            lockedIntent.stagingAudioR2Key !== intent.stagingAudioR2Key ||
            lockedIntent.audioSizeBytes !== stored.sizeBytes ||
            lockedIntent.audioContentType !== stored.contentType
          ) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "The upload changed before it could be saved",
            );
          }

          const [positionRow] = await tx
            .select({
              position: sql<number>`coalesce(max(${projectTracks.position}), -1) + 1`,
            })
            .from(projectTracks)
            .where(eq(projectTracks.projectId, intent.projectId));
          await tx.insert(projectTracks).values({
            id: intent.trackId,
            projectId: intent.projectId,
            purchaseId: intent.purchaseId,
            title: intent.title,
            artist: intent.artist,
            position: positionRow?.position ?? 0,
          });
          await tx.insert(trackVersions).values({
            id: intent.versionId,
            trackId: intent.trackId,
            purchaseId: intent.purchaseId,
            producerId: ctx.producerId,
            label: intent.label,
            audioUrl: url,
            durationMs: intent.durationMs,
            description: intent.description,
            audioR2Key: intent.audioR2Key,
            sizeBytes: stored.sizeBytes,
            audioObjectEtag: stored.objectEtag,
            audioIdentityFingerprint,
            peaks,
          });
          const completedAt = new Date();
          const [updatedIntent] = await tx
            .update(firstVersionUploadIntents)
            .set({ completedAt, updatedAt: completedAt })
            .where(
              and(
                eq(firstVersionUploadIntents.id, intent.id),
                eq(firstVersionUploadIntents.producerId, ctx.producerId),
                isNull(firstVersionUploadIntents.completedAt),
                isNull(firstVersionUploadIntents.canceledAt),
              ),
            )
            .returning({ id: firstVersionUploadIntents.id });
          if (!updatedIntent) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "The upload changed before it could be saved",
            );
          }
          await tx
            .update(projects)
            .set({ updatedAt: completedAt })
            .where(and(eq(projects.id, intent.projectId), eq(projects.producerId, ctx.producerId)));
          return { projectId: intent.projectId, trackId: intent.trackId, newlyCompleted: true };
        });

        await deleteFirstVersionUploadIfExact({
          key: intent.stagingAudioR2Key,
          sizeBytes: intent.audioSizeBytes,
          contentType: intent.audioContentType,
          completionToken: intent.completionToken,
        }).catch(() => false);

        // Preserve the notification behavior of the previous V1 multipart
        // path, but only for the transaction that actually created Song + V1.
        if (completed.newlyCompleted) {
          after(async () => {
            try {
              const [projectRow] = await ctx.db
                .select({
                  title: projects.title,
                  artistName: projects.artistName,
                  artistEmail: projects.artistEmail,
                  clientContactId: projects.clientContactId,
                })
                .from(projects)
                .where(
                  and(eq(projects.id, intent.projectId), eq(projects.producerId, ctx.producerId)),
                )
                .limit(1);
              if (!projectRow) return;
              const [producerRow] = await ctx.db
                .select({ displayName: producers.displayName })
                .from(producers)
                .where(eq(producers.id, ctx.producerId))
                .limit(1);
              const [artistContact] = await ctx.db
                .select({ clerkUserId: clientContacts.clerkUserId })
                .from(clientContacts)
                .where(
                  and(
                    eq(clientContacts.id, projectRow.clientContactId),
                    eq(clientContacts.producerId, ctx.producerId),
                    isNull(clientContacts.archivedAt),
                  ),
                )
                .limit(1);
              const producerName = producerRow?.displayName ?? "Your producer";
              let emailEnabled = true;
              try {
                const delivery = await emitArtistNewVersionNotification(ctx.db, {
                  recipientClerkUserId: artistContact?.clerkUserId ?? null,
                  producerId: ctx.producerId,
                  trackVersionId: intent.versionId,
                  producerName,
                  trackTitle: intent.title,
                  versionLabel: intent.label,
                });
                emailEnabled = delivery.emailEnabled;
              } catch (error) {
                console.warn("[artist-notify] track-version event failed", error);
              }
              if (!emailEnabled) return;
              try {
                await sendTrackVersionUploadedEmail(projectRow.artistEmail, {
                  artistName: projectRow.artistName,
                  producerName,
                  projectName: projectRow.title,
                  versionLabel: intent.label,
                  reviewUrl: `${SITE_URL}/artist/music/song/${intent.versionId}`,
                });
              } catch (error) {
                console.error("[email] track-version-uploaded failed", error);
              }
            } catch (error) {
              console.warn("[artist-notify] track-version delivery failed", error);
            }
          });
        }
        return {
          projectId: completed.projectId,
          trackId: completed.trackId,
          versionId: intent.versionId,
          url,
        };
      } catch (error) {
        if (
          error instanceof FirstVersionUploadError &&
          (error.code === "CANCELED" || error.code === "EXPIRED")
        ) {
          await cleanIntentObjects(intent);
        }
        mapFirstVersionUploadError(error);
      }
    }),

  cancel: producerProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const intent = await ctx.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(firstVersionUploadIntents)
          .where(
            and(
              eq(firstVersionUploadIntents.id, input.intentId),
              eq(firstVersionUploadIntents.producerId, ctx.producerId),
            ),
          )
          .limit(1)
          .for("update");
        if (!locked) return null;
        if (locked.completedAt || locked.canceledAt) return locked;
        const canceledAt = new Date();
        const [updated] = await tx
          .update(firstVersionUploadIntents)
          .set({ canceledAt, updatedAt: canceledAt })
          .where(
            and(
              eq(firstVersionUploadIntents.id, locked.id),
              isNull(firstVersionUploadIntents.completedAt),
              isNull(firstVersionUploadIntents.canceledAt),
            ),
          )
          .returning();
        return updated ?? locked;
      });
      if (intent && !intent.completedAt) await cleanIntentObjects(intent);
      return { ok: true as const, completed: Boolean(intent?.completedAt) };
    }),
});
