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
  AudioStorageQuotaError,
  assertProducerAudioStorageAvailable,
  lockProducerAudioStorageQuota,
} from "~/server/domain/audio-storage/quota";
import {
  FirstVersionUploadError,
  assertFirstVersionAudioFile,
  assertFirstVersionUploadDestination,
  createFirstVersionRequestDigest,
  createStoredAudioIdentityFingerprint,
  presignFirstVersionUploadWithCompensation,
} from "~/server/domain/first-version-uploads/service";
import { reconcileProducerFirstVersionUploadReservations } from "~/server/domain/first-version-uploads/reconciliation";
import {
  FirstVersionUploadPresignError,
  buildFirstVersionStagingKey,
  computeFirstVersionUploadPeaks,
  createFirstVersionUploadUrl,
  finalizeFirstVersionUpload,
  reconcileFirstVersionFinalDeletion,
  sealFirstVersionStagingUpload,
} from "~/server/domain/first-version-uploads/storage";
import { emitArtistNewVersionNotification } from "~/server/artist/notification-emitters";
import { SITE_URL, sendTrackVersionUploadedEmail } from "~/server/email/send";
import { buildAudioKey } from "~/server/storage/r2";

const INTENT_TTL_MS = 24 * 60 * 60 * 1_000;

type FirstVersionUploadIntentRow = typeof firstVersionUploadIntents.$inferSelect;
type FirstVersionSealDb = Parameters<typeof lockProducerAudioStorageQuota>[0];

function firstVersionStagingIdentity(intent: FirstVersionUploadIntentRow) {
  return {
    key: intent.stagingAudioR2Key,
    sizeBytes: intent.audioSizeBytes,
    contentType: intent.audioContentType,
    completionToken: intent.completionToken,
  };
}

function firstVersionFinalIdentity(intent: FirstVersionUploadIntentRow) {
  return {
    key: intent.audioR2Key,
    sizeBytes: intent.audioSizeBytes,
    contentType: intent.audioContentType,
    completionToken: intent.completionToken,
  };
}

async function databaseTimeHasPassed(
  db: FirstVersionSealDb,
  timestamp: Date,
): Promise<boolean> {
  const result = await db.execute<{ passed: boolean }>(sql`
    select now() >= ${timestamp} as "passed"
  `);
  return result.rows[0]?.passed === true;
}

function assertFirstVersionStagingCanSeal(intent: FirstVersionUploadIntentRow): void {
  if (
    intent.uploadUrlWriteOnceProtectedAt ||
    intent.legacyUploadCapabilitiesRevokedAt ||
    !intent.latestUploadUrlExpiresAt
  ) {
    return;
  }
  throw new FirstVersionUploadError(
    "CONFLICT",
    "This older upload cannot be cleared safely yet. Contact support before retrying.",
  );
}

async function sealFirstVersionIntentStorage(
  intent: FirstVersionUploadIntentRow,
): Promise<void> {
  if (intent.stagingSealedAt) return;
  assertFirstVersionStagingCanSeal(intent);
  await sealFirstVersionStagingUpload(firstVersionStagingIdentity(intent));
}

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
  if (error instanceof AudioStorageQuotaError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
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

      await reconcileProducerFirstVersionUploadReservations(ctx.db, ctx.producerId);

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
          if (!existing.stagingSealedAt) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "This upload still needs to be secured. Retry finishing the upload.",
            );
          }
          return {
            status: "completed" as const,
            intentId: existing.id,
            projectId: existing.projectId,
            trackId: existing.trackId,
            versionId: existing.versionId,
          };
        }
        if (existing.stagingSealedAt) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "This upload was already secured. Retry finishing the upload.",
          );
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
      const { intent, inserted } = await ctx.db.transaction(async (tx) => {
        await lockProducerAudioStorageQuota(tx, ctx.producerId);

        // The unlocked fast-path above keeps ordinary retries cheap. Recheck
        // under the producer quota lock so two different server instances can
        // never reserve the same operation twice.
        const [racedExisting] = await tx
          .select()
          .from(firstVersionUploadIntents)
          .where(
            and(
              eq(firstVersionUploadIntents.producerId, ctx.producerId),
              eq(firstVersionUploadIntents.operationKey, input.operationKey),
            ),
          )
          .limit(1);
        if (racedExisting) {
          assertIntentCanUpload(racedExisting, requestDigest);
          if (racedExisting.stagingSealedAt && !racedExisting.completedAt) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "This upload was already secured. Retry finishing the upload.",
            );
          }
          return { intent: racedExisting, inserted: null };
        }

        await assertProducerAudioStorageAvailable(tx, ctx.producerId, input.sizeBytes);
        const [newIntent] = await tx
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
            expiresAt: sql`now() + make_interval(secs => ${INTENT_TTL_MS / 1_000})`,
            createdAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .onConflictDoNothing()
          .returning();
        const intent =
          newIntent ??
          (
            await tx
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
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Upload could not start",
          });
        }
        assertIntentCanUpload(intent, requestDigest);
        return { intent, inserted: newIntent ?? null };
      });
      assertIntentCanUpload(intent, requestDigest);
      if (intent.completedAt) {
        if (!intent.stagingSealedAt) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "This upload still needs to be secured. Retry finishing the upload.",
          );
        }
        return {
          status: "completed" as const,
          intentId: intent.id,
          projectId: intent.projectId,
          trackId: intent.trackId,
          versionId: intent.versionId,
        };
      }
      if (!inserted) {
        assertFirstVersionUploadDestination(
          destinations.find((candidate) => candidate.purchaseId === intent.purchaseId) ?? null,
          { producerId: ctx.producerId, projectId: input.projectId },
        );
      }
      const capability = await presignFirstVersionUploadWithCompensation({
        newlyInserted: Boolean(inserted),
        presign: () =>
          ctx.db.transaction(async (tx) => {
            await lockProducerAudioStorageQuota(tx, ctx.producerId);
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
            assertIntentCanUpload(lockedIntent, requestDigest);
            if (lockedIntent.completedAt) {
              if (!lockedIntent.stagingSealedAt) {
                await sealFirstVersionIntentStorage(lockedIntent);
                await tx
                  .update(firstVersionUploadIntents)
                  .set({
                    stagingSealedAt: sql`now()`,
                    updatedAt: sql`now()`,
                  })
                  .where(
                    and(
                      eq(firstVersionUploadIntents.id, lockedIntent.id),
                      eq(firstVersionUploadIntents.producerId, ctx.producerId),
                      isNull(firstVersionUploadIntents.stagingSealedAt),
                    ),
                  );
              }
              return { status: "completed" as const, capability: null };
            }
            if (lockedIntent.stagingSealedAt) {
              throw new FirstVersionUploadError(
                "CONFLICT",
                "This upload was already secured. Retry finishing the upload.",
              );
            }
            // Legacy unconditional URLs are not safely upgradable: a request
            // already in flight could outlive URL expiry and overwrite a
            // marker. Only an operator-recorded credential revocation unlocks
            // those rows for reconciliation.
            assertFirstVersionStagingCanSeal(lockedIntent);
            const capability = await createFirstVersionUploadUrl({
              key: lockedIntent.stagingAudioR2Key,
              sizeBytes: lockedIntent.audioSizeBytes,
              contentType: lockedIntent.audioContentType,
              completionToken: lockedIntent.completionToken,
            });
            const [issued] = await tx
              .update(firstVersionUploadIntents)
              .set({
                latestUploadUrlExpiresAt: sql`greatest(
                  coalesce(${firstVersionUploadIntents.latestUploadUrlExpiresAt}, ${capability.expiresAt}),
                  ${capability.expiresAt}
                )`,
                uploadUrlWriteOnceProtectedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(firstVersionUploadIntents.id, lockedIntent.id),
                  eq(firstVersionUploadIntents.producerId, ctx.producerId),
                  isNull(firstVersionUploadIntents.completedAt),
                  isNull(firstVersionUploadIntents.canceledAt),
                  isNull(firstVersionUploadIntents.stagingSealedAt),
                ),
              )
              .returning({ id: firstVersionUploadIntents.id });
            if (!issued) {
              throw new FirstVersionUploadError(
                "CONFLICT",
                "The upload changed while its secure link was being prepared",
              );
            }
            return {
              status: "ready" as const,
              capability: {
                uploadUrl: capability.uploadUrl,
                headers: capability.headers,
                expiresInSeconds: capability.expiresInSeconds,
              },
            };
          }),
        compensate: async () => {
          await ctx.db.transaction(async (tx) => {
            await lockProducerAudioStorageQuota(tx, ctx.producerId);
            await tx
              .delete(firstVersionUploadIntents)
              .where(
                and(
                  eq(firstVersionUploadIntents.id, intent.id),
                  eq(firstVersionUploadIntents.producerId, ctx.producerId),
                  isNull(firstVersionUploadIntents.completedAt),
                  isNull(firstVersionUploadIntents.canceledAt),
                ),
              );
          });
        },
      });
      if (capability.status === "completed") {
        return {
          status: "completed" as const,
          intentId: intent.id,
          projectId: intent.projectId,
          trackId: intent.trackId,
          versionId: intent.versionId,
        };
      }
      return {
        status: "ready" as const,
        intentId: intent.id,
        projectId: intent.projectId,
        trackId: intent.trackId,
        versionId: intent.versionId,
        ...capability.capability,
      };
    } catch (error) {
      mapFirstVersionUploadError(error);
    }
  }),

  complete: producerProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const completed = await ctx.db.transaction(async (tx) => {
          await lockProducerAudioStorageQuota(tx, ctx.producerId);
          const [lockedIntent] = await tx
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
          if (!lockedIntent) {
            throw new FirstVersionUploadError("NOT_FOUND", "The upload intent was not found");
          }
          if (lockedIntent.completedAt) {
            let completedIntent = lockedIntent;
            if (!lockedIntent.stagingSealedAt) {
              await sealFirstVersionIntentStorage(lockedIntent);
              const [sealed] = await tx
                .update(firstVersionUploadIntents)
                .set({
                  stagingSealedAt: sql`now()`,
                  updatedAt: sql`now()`,
                })
                .where(
                  and(
                    eq(firstVersionUploadIntents.id, lockedIntent.id),
                    eq(firstVersionUploadIntents.producerId, ctx.producerId),
                    isNull(firstVersionUploadIntents.stagingSealedAt),
                  ),
                )
                .returning();
              if (!sealed) {
                throw new FirstVersionUploadError(
                  "CONFLICT",
                  "The completed upload could not be secured",
                );
              }
              completedIntent = sealed;
            }
            return {
              intent: completedIntent,
              projectId: lockedIntent.projectId,
              trackId: lockedIntent.trackId,
              url: privateVersionStreamPath(lockedIntent.versionId),
              newlyCompleted: false,
              terminalError: null,
            };
          }
          const intentExpired = await databaseTimeHasPassed(tx, lockedIntent.expiresAt);
          if (lockedIntent.canceledAt || intentExpired) {
            if (!lockedIntent.stagingSealedAt) {
              await reconcileFirstVersionFinalDeletion(firstVersionFinalIdentity(lockedIntent));
              await sealFirstVersionIntentStorage(lockedIntent);
              const [sealed] = await tx
                .update(firstVersionUploadIntents)
                .set({
                  stagingSealedAt: sql`now()`,
                  updatedAt: sql`now()`,
                })
                .where(
                  and(
                    eq(firstVersionUploadIntents.id, lockedIntent.id),
                    eq(firstVersionUploadIntents.producerId, ctx.producerId),
                    isNull(firstVersionUploadIntents.stagingSealedAt),
                  ),
                )
                .returning({ id: firstVersionUploadIntents.id });
              if (!sealed) {
                throw new FirstVersionUploadError(
                  "CONFLICT",
                  "The inactive upload could not be secured",
                );
              }
            }
            return {
              intent: lockedIntent,
              projectId: lockedIntent.projectId,
              trackId: lockedIntent.trackId,
              url: privateVersionStreamPath(lockedIntent.versionId),
              newlyCompleted: false,
              terminalError: lockedIntent.canceledAt
                ? ({
                    code: "CANCELED" as const,
                    message: "This upload was canceled. Choose the file again.",
                  } as const)
                : ({
                    code: "EXPIRED" as const,
                    message: "This upload expired. Choose the file again.",
                  } as const),
            };
          }
          assertIntentCanUpload(lockedIntent, lockedIntent.requestDigest);
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${lockedIntent.projectId}, 0))`,
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${lockedIntent.purchaseId}, 0))`,
          );
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(eq(projects.id, lockedIntent.projectId))
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
            .where(eq(purchases.id, lockedIntent.purchaseId))
            .limit(1)
            .for("update");
          const allocatedRows = await tx
            .select({ id: projectTracks.id })
            .from(projectTracks)
            .where(
              and(
                eq(projectTracks.projectId, lockedIntent.projectId),
                eq(projectTracks.purchaseId, lockedIntent.purchaseId),
                ne(projectTracks.id, lockedIntent.trackId),
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
            { producerId: ctx.producerId, projectId: lockedIntent.projectId },
          );
          assertIntentCanUpload(lockedIntent, lockedIntent.requestDigest);

          if (!lockedIntent.stagingSealedAt) {
            assertFirstVersionStagingCanSeal(lockedIntent);
          }
          const stored = await finalizeFirstVersionUpload({
            stagingKey: lockedIntent.stagingAudioR2Key,
            finalKey: lockedIntent.audioR2Key,
            sizeBytes: lockedIntent.audioSizeBytes,
            contentType: lockedIntent.audioContentType,
            completionToken: lockedIntent.completionToken,
          });
          if (
            lockedIntent.audioSizeBytes !== stored.sizeBytes ||
            lockedIntent.audioContentType !== stored.contentType
          ) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "The upload changed before it could be saved",
            );
          }
          if (!lockedIntent.stagingSealedAt) {
            await sealFirstVersionStagingUpload(firstVersionStagingIdentity(lockedIntent));
          }
          const peaks = await computeFirstVersionUploadPeaks(lockedIntent.audioR2Key);
          const audioIdentityFingerprint = createStoredAudioIdentityFingerprint({
            key: lockedIntent.audioR2Key,
            objectEtag: stored.objectEtag,
            sizeBytes: stored.sizeBytes,
          });
          const url = privateVersionStreamPath(lockedIntent.versionId);

          const [positionRow] = await tx
            .select({
              position: sql<number>`coalesce(max(${projectTracks.position}), -1) + 1`,
            })
            .from(projectTracks)
            .where(eq(projectTracks.projectId, lockedIntent.projectId));
          await tx.insert(projectTracks).values({
            id: lockedIntent.trackId,
            projectId: lockedIntent.projectId,
            purchaseId: lockedIntent.purchaseId,
            title: lockedIntent.title,
            artist: lockedIntent.artist,
            position: positionRow?.position ?? 0,
          });
          await tx.insert(trackVersions).values({
            id: lockedIntent.versionId,
            trackId: lockedIntent.trackId,
            purchaseId: lockedIntent.purchaseId,
            producerId: ctx.producerId,
            label: lockedIntent.label,
            audioUrl: url,
            durationMs: lockedIntent.durationMs,
            description: lockedIntent.description,
            audioR2Key: lockedIntent.audioR2Key,
            sizeBytes: stored.sizeBytes,
            audioObjectEtag: stored.objectEtag,
            audioIdentityFingerprint,
            peaks,
          });
          const [updatedIntent] = await tx
            .update(firstVersionUploadIntents)
            .set({
              completedAt: sql`now()`,
              stagingSealedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(firstVersionUploadIntents.id, lockedIntent.id),
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
            .set({ updatedAt: sql`now()` })
            .where(
              and(eq(projects.id, lockedIntent.projectId), eq(projects.producerId, ctx.producerId)),
            );
          return {
            intent: lockedIntent,
            projectId: lockedIntent.projectId,
            trackId: lockedIntent.trackId,
            url,
            newlyCompleted: true,
            terminalError: null,
          };
        });

        if (completed.terminalError) {
          throw new FirstVersionUploadError(
            completed.terminalError.code,
            completed.terminalError.message,
          );
        }

        const intent = completed.intent;
        const url = completed.url;

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
              let emailEnabled = false;
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
        mapFirstVersionUploadError(error);
      }
    }),

  cancel: producerProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const intent = await ctx.db.transaction(async (tx) => {
        await lockProducerAudioStorageQuota(tx, ctx.producerId);
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
        if (
          locked.latestUploadUrlExpiresAt &&
          !locked.uploadUrlWriteOnceProtectedAt &&
          !locked.legacyUploadCapabilitiesRevokedAt &&
          !locked.stagingSealedAt
        ) {
          const [updated] = await tx
            .update(firstVersionUploadIntents)
            .set({
              canceledAt: locked.completedAt
                ? locked.canceledAt
                : sql`coalesce(${firstVersionUploadIntents.canceledAt}, now())`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(firstVersionUploadIntents.id, locked.id),
                eq(firstVersionUploadIntents.producerId, ctx.producerId),
              ),
            )
            .returning();
          return updated ?? locked;
        }

        let sealObserved = Boolean(locked.stagingSealedAt);
        if (!sealObserved) {
          try {
            if (!locked.completedAt) {
              await reconcileFirstVersionFinalDeletion(firstVersionFinalIdentity(locked));
            }
            await sealFirstVersionIntentStorage(locked);
            sealObserved = true;
          } catch (error) {
            // Cancellation is still durable, but quota remains reserved until
            // a later retry/lazy pass authoritatively observes the marker.
            console.warn(
              "[first-version-upload] cancel staging seal failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        const [updated] = await tx
          .update(firstVersionUploadIntents)
          .set({
            ...(sealObserved
              ? {
                  stagingSealedAt: locked.stagingSealedAt ?? sql`now()`,
                }
              : {}),
            canceledAt: locked.completedAt
              ? locked.canceledAt
              : sql`coalesce(${firstVersionUploadIntents.canceledAt}, now())`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(firstVersionUploadIntents.id, locked.id),
              eq(firstVersionUploadIntents.producerId, ctx.producerId),
            ),
          )
          .returning();
        return updated ?? locked;
      });
      if (
        intent?.latestUploadUrlExpiresAt &&
        !intent.uploadUrlWriteOnceProtectedAt &&
        !intent.legacyUploadCapabilitiesRevokedAt &&
        !intent.stagingSealedAt
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This older upload cannot be cleared safely yet. Contact support before retrying.",
        });
      }
      return { ok: true as const, completed: Boolean(intent?.completedAt) };
    }),
});
