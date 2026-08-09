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
  songPublicLinks,
  sql,
  trackVersions,
  type Db,
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
  createAudioFinalizationDigest,
  createFirstVersionRequestDigest,
  createStagedAudioRequestDigest,
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
import {
  requireSongUploadPublicExposureAcknowledgement,
  SongUploadPublicExposureError,
} from "~/server/domain/song-publication/upload-exposure";
import {
  assertActiveVersionUploadLifecycle,
  VersionUploadDomainError,
} from "~/server/domain/version-uploads/service";
import { currentTrackArtistApprovalAction } from "~/server/domain/version-uploads/db";

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

async function databaseTimeHasPassed(db: FirstVersionSealDb, timestamp: Date): Promise<boolean> {
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

async function sealFirstVersionIntentStorage(intent: FirstVersionUploadIntentRow): Promise<void> {
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

const stageInput = z.object({
  operationKey: z.string().min(16).max(200),
  filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentType: z.string().trim().min(1).max(120),
});

const finalizeInput = z.object({
  intentId: z.string().uuid(),
  destination: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("new-song"),
      projectId: z.string().uuid(),
      title: z.string().trim().min(1, "Song title is required").max(120),
      artist: z.string().trim().min(1).max(120).nullish(),
    }),
    z.object({
      kind: z.literal("new-version"),
      projectId: z.string().uuid(),
      trackId: z.string().uuid(),
    }),
  ]),
  label: z.string().trim().min(1, "Version label is required").max(40),
  description: z.string().trim().min(1).max(500).nullish(),
  durationMs: z.number().int().positive().max(86_400_000).nullish(),
  acknowledgePublicExposure: z.boolean(),
});

type FinalizeAudioUploadInput = z.infer<typeof finalizeInput>;
type BoundAudioUploadIntent = FirstVersionUploadIntentRow & {
  projectId: string;
  purchaseId: string;
  title: string;
  label: string;
  createsTrack: boolean;
  finalizationDigest: string;
};
type LegacyBoundAudioUploadIntent = FirstVersionUploadIntentRow & {
  projectId: string;
  purchaseId: string;
  title: string;
  label: string;
};

function assertBoundAudioUploadIntent(
  intent: FirstVersionUploadIntentRow,
): asserts intent is BoundAudioUploadIntent {
  if (
    !intent.projectId ||
    !intent.purchaseId ||
    !intent.title ||
    !intent.label ||
    intent.createsTrack === null ||
    !intent.finalizationDigest
  ) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "Finish choosing the upload destination and details before saving this audio",
    );
  }
}

function assertLegacyFirstVersionIntent(
  intent: FirstVersionUploadIntentRow,
  requestDigest: string,
): asserts intent is BoundAudioUploadIntent & { createsTrack: true } {
  assertBoundAudioUploadIntent(intent);
  if (!intent.createsTrack || intent.finalizationDigest !== requestDigest) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This staged upload must be finished from the current Upload audio flow",
    );
  }
}

function assertLegacyIntentCanUpgrade(
  intent: FirstVersionUploadIntentRow,
  requestDigest: string,
): asserts intent is LegacyBoundAudioUploadIntent {
  if (!intent.projectId || !intent.purchaseId || !intent.title || !intent.label) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This staged upload must be finished from the current Upload audio flow",
    );
  }
  const alreadyUpgraded =
    intent.createsTrack === true && intent.finalizationDigest === requestDigest;
  const needsUpgrade = intent.createsTrack === null && intent.finalizationDigest === null;
  if (!alreadyUpgraded && !needsUpgrade) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This staged upload's legacy finalization state did not match",
    );
  }
}

async function upgradeLegacyIntentIfNeeded(
  db: Pick<Db, "update">,
  producerId: string,
  intent: FirstVersionUploadIntentRow,
  requestDigest: string,
): Promise<BoundAudioUploadIntent & { createsTrack: true }> {
  assertLegacyIntentCanUpgrade(intent, requestDigest);
  if (intent.createsTrack === null && intent.finalizationDigest === null) {
    const [upgraded] = await db
      .update(firstVersionUploadIntents)
      .set({
        createsTrack: true,
        finalizationDigest: requestDigest,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(firstVersionUploadIntents.id, intent.id),
          eq(firstVersionUploadIntents.producerId, producerId),
          eq(firstVersionUploadIntents.requestDigest, requestDigest),
          isNull(firstVersionUploadIntents.createsTrack),
          isNull(firstVersionUploadIntents.finalizationDigest),
        ),
      )
      .returning();
    if (!upgraded) {
      throw new FirstVersionUploadError(
        "CONFLICT",
        "This upload changed while its legacy details were being secured",
      );
    }
    assertLegacyFirstVersionIntent(upgraded, requestDigest);
    return upgraded;
  }
  assertLegacyFirstVersionIntent(intent, requestDigest);
  return intent;
}

function normalizedFinalizeInput(input: FinalizeAudioUploadInput) {
  return {
    ...input,
    destination:
      input.destination.kind === "new-song"
        ? { ...input.destination, artist: input.destination.artist ?? null }
        : input.destination,
    description: input.description ?? null,
    durationMs: input.durationMs ?? null,
  };
}

function assertFinalizeInputMatchesBinding(
  intent: BoundAudioUploadIntent,
  input: ReturnType<typeof normalizedFinalizeInput>,
): void {
  if (
    intent.projectId !== input.destination.projectId ||
    intent.label !== input.label ||
    intent.description !== input.description ||
    intent.durationMs !== input.durationMs
  ) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This upload was already bound to different Song or Version details",
    );
  }
  if (
    input.destination.kind === "new-song"
      ? !intent.createsTrack ||
        intent.title !== input.destination.title ||
        intent.artist !== input.destination.artist
      : intent.createsTrack || intent.trackId !== input.destination.trackId
  ) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This upload was already bound to different Song or Version details",
    );
  }
  const digest = createAudioFinalizationDigest({
    createsTrack: intent.createsTrack,
    projectId: intent.projectId,
    purchaseId: intent.purchaseId,
    trackId: intent.trackId,
    title: intent.title,
    artist: intent.artist,
    label: intent.label,
    description: intent.description,
    durationMs: intent.durationMs,
  });
  if (digest !== intent.finalizationDigest) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This upload's frozen finalization details did not match",
    );
  }
}

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
  if (error instanceof SongUploadPublicExposureError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  if (error instanceof VersionUploadDomainError) {
    throw new TRPCError({
      code: error.code === "INACTIVE" ? "PRECONDITION_FAILED" : "NOT_FOUND",
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
      "This upload retry contains different audio file details",
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

function scheduleStagedAudioArtistDelivery(
  db: Db,
  producerId: string,
  intent: BoundAudioUploadIntent,
): void {
  after(async () => {
    try {
      const [projectRow] = await db
        .select({
          title: projects.title,
          artistName: projects.artistName,
          artistEmail: projects.artistEmail,
          clientContactId: projects.clientContactId,
        })
        .from(projects)
        .where(and(eq(projects.id, intent.projectId), eq(projects.producerId, producerId)))
        .limit(1);
      if (!projectRow) return;
      const [trackRow] = await db
        .select({ title: projectTracks.title })
        .from(projectTracks)
        .where(
          and(
            eq(projectTracks.id, intent.trackId),
            eq(projectTracks.projectId, intent.projectId),
            eq(projectTracks.purchaseId, intent.purchaseId),
          ),
        )
        .limit(1);
      if (!trackRow) return;
      const [producerRow] = await db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, producerId))
        .limit(1);
      const [artistContact] = await db
        .select({ clerkUserId: clientContacts.clerkUserId })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.id, projectRow.clientContactId),
            eq(clientContacts.producerId, producerId),
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      const producerName = producerRow?.displayName ?? "Your producer";
      let emailEnabled = false;
      try {
        const delivery = await emitArtistNewVersionNotification(db, {
          recipientClerkUserId: artistContact?.clerkUserId ?? null,
          producerId,
          trackVersionId: intent.versionId,
          producerName,
          trackTitle: trackRow.title,
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

export const firstVersionUploadRouter = router({
  stage: producerProcedure.input(stageInput).mutation(async ({ ctx, input }) => {
    try {
      assertFirstVersionAudioFile(input);
      const normalized = {
        ...input,
        contentType: input.contentType.toLowerCase(),
      };
      const requestDigest = createStagedAudioRequestDigest(normalized);

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
          assertBoundAudioUploadIntent(existing);
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
            operationKey: input.operationKey,
            requestDigest,
            trackId,
            versionId,
            stagingAudioR2Key,
            audioR2Key,
            audioContentType: normalized.contentType,
            audioSizeBytes: input.sizeBytes,
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
              .for("update")
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
        assertBoundAudioUploadIntent(intent);
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
                  .set({ stagingSealedAt: sql`now()`, updatedAt: sql`now()` })
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
        assertBoundAudioUploadIntent(intent);
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
        versionId: intent.versionId,
        ...capability.capability,
      };
    } catch (error) {
      mapFirstVersionUploadError(error);
    }
  }),

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
        assertLegacyIntentCanUpgrade(existing, requestDigest);
        if (existing.completedAt) {
          assertLegacyFirstVersionIntent(existing, requestDigest);
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
          .limit(1)
          .for("update");
        if (racedExisting) {
          assertIntentCanUpload(racedExisting, requestDigest);
          const legacyIntent = await upgradeLegacyIntentIfNeeded(
            tx,
            ctx.producerId,
            racedExisting,
            requestDigest,
          );
          if (legacyIntent.stagingSealedAt && !legacyIntent.completedAt) {
            throw new FirstVersionUploadError(
              "CONFLICT",
              "This upload was already secured. Retry finishing the upload.",
            );
          }
          return { intent: legacyIntent, inserted: null };
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
            finalizationDigest: requestDigest,
            createsTrack: true,
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
              .for("update")
          )[0];
        if (!intent) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Upload could not start",
          });
        }
        assertIntentCanUpload(intent, requestDigest);
        const compatibleIntent = await upgradeLegacyIntentIfNeeded(
          tx,
          ctx.producerId,
          intent,
          requestDigest,
        );
        return { intent: compatibleIntent, inserted: newIntent ?? null };
      });
      assertIntentCanUpload(intent, requestDigest);
      assertLegacyFirstVersionIntent(intent, requestDigest);
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

  finalize: producerProcedure.input(finalizeInput).mutation(async ({ ctx, input }) => {
    try {
      const normalized = normalizedFinalizeInput(input);

      // Persist the exact durable outcome before the first server-side R2 copy.
      // A retry may authorize the same binding, but can never rewrite it.
      const boundIntent = await ctx.db.transaction(async (tx) => {
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
        if (lockedIntent.canceledAt) {
          throw new FirstVersionUploadError(
            "CANCELED",
            "This upload was canceled. Choose the file again.",
          );
        }
        if (
          !lockedIntent.completedAt &&
          (await databaseTimeHasPassed(tx, lockedIntent.expiresAt))
        ) {
          throw new FirstVersionUploadError(
            "EXPIRED",
            "This upload expired. Choose the file again.",
          );
        }
        if (lockedIntent.stagingSealedAt && !lockedIntent.completedAt) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "This upload was already secured. Choose the file again.",
          );
        }
        if (lockedIntent.finalizationDigest) {
          assertBoundAudioUploadIntent(lockedIntent);
          assertFinalizeInputMatchesBinding(lockedIntent, normalized);
          return lockedIntent;
        }
        if (
          lockedIntent.projectId !== null ||
          lockedIntent.purchaseId !== null ||
          lockedIntent.title !== null ||
          lockedIntent.label !== null ||
          lockedIntent.createsTrack !== null
        ) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "This legacy upload must be finished from the flow that started it",
          );
        }

        let binding: Omit<BoundAudioUploadIntent, keyof FirstVersionUploadIntentRow> &
          Pick<
            BoundAudioUploadIntent,
            | "projectId"
            | "purchaseId"
            | "trackId"
            | "title"
            | "artist"
            | "label"
            | "description"
            | "durationMs"
            | "createsTrack"
            | "finalizationDigest"
          >;

        if (normalized.destination.kind === "new-song") {
          const projectId = normalized.destination.projectId;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), eq(projects.producerId, ctx.producerId)))
            .limit(1)
            .for("update");
          const purchaseRows = await tx
            .select({
              id: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              lifecycleStatus: purchases.lifecycleStatus,
              commercialSnapshot: purchases.commercialSnapshot,
            })
            .from(purchases)
            .where(
              and(eq(purchases.projectId, projectId), eq(purchases.producerId, ctx.producerId)),
            )
            .orderBy(asc(purchases.acceptedAt), asc(purchases.id));
          const allocatedRows = await tx
            .select({ purchaseId: projectTracks.purchaseId })
            .from(projectTracks)
            .where(eq(projectTracks.projectId, projectId));
          const allocatedByPurchase = new Map<string, number>();
          for (const row of allocatedRows) {
            allocatedByPurchase.set(
              row.purchaseId,
              (allocatedByPurchase.get(row.purchaseId) ?? 0) + 1,
            );
          }
          const destinations = purchaseRows.map((row) => ({
            ...row,
            allocatedSongSpaces: allocatedByPurchase.get(row.id) ?? 0,
            includedSongSpaces: row.commercialSnapshot.includedSongSpaces,
          }));
          const selected =
            destinations.find(
              (candidate) =>
                candidate.lifecycleStatus === "active" &&
                Number.isSafeInteger(candidate.includedSongSpaces) &&
                candidate.allocatedSongSpaces < candidate.includedSongSpaces,
            ) ?? destinations.find((candidate) => candidate.lifecycleStatus === "active");
          if (selected) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${selected.id}, 0))`,
            );
          }
          const [lockedPurchase] = selected
            ? await tx
                .select({
                  id: purchases.id,
                  producerId: purchases.producerId,
                  projectId: purchases.projectId,
                  lifecycleStatus: purchases.lifecycleStatus,
                  commercialSnapshot: purchases.commercialSnapshot,
                })
                .from(purchases)
                .where(eq(purchases.id, selected.id))
                .limit(1)
                .for("update")
            : [];
          const destination = assertFirstVersionUploadDestination(
            lockedProject && lockedPurchase
              ? {
                  producerId: ctx.producerId,
                  projectId,
                  purchaseId: lockedPurchase.id,
                  projectProducerId: lockedProject.producerId,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseProducerId: lockedPurchase.producerId,
                  purchaseProjectId: lockedPurchase.projectId,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                  includedSongSpaces: lockedPurchase.commercialSnapshot.includedSongSpaces,
                  allocatedSongSpaces: allocatedByPurchase.get(lockedPurchase.id) ?? 0,
                }
              : null,
            { producerId: ctx.producerId, projectId },
          );
          const values = {
            createsTrack: true,
            projectId,
            purchaseId: destination.purchaseId,
            trackId: lockedIntent.trackId,
            title: normalized.destination.title,
            artist: normalized.destination.artist,
            label: normalized.label,
            description: normalized.description,
            durationMs: normalized.durationMs,
          };
          binding = {
            ...values,
            finalizationDigest: createAudioFinalizationDigest(values),
          };
        } else {
          const { projectId, trackId } = normalized.destination;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
          const [lockedProject] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), eq(projects.producerId, ctx.producerId)))
            .limit(1)
            .for("update");
          const [discoveredTrack] = await tx
            .select({ purchaseId: projectTracks.purchaseId })
            .from(projectTracks)
            .where(and(eq(projectTracks.id, trackId), eq(projectTracks.projectId, projectId)))
            .limit(1);
          if (!lockedProject || !discoveredTrack) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version upload scope was not found",
            );
          }
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${discoveredTrack.purchaseId}, 0))`,
          );
          const [lockedPurchase] = await tx
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
          const [lockedTrack] = await tx
            .select({
              id: projectTracks.id,
              projectId: projectTracks.projectId,
              purchaseId: projectTracks.purchaseId,
              title: projectTracks.title,
              artist: projectTracks.artist,
              archivedAt: projectTracks.archivedAt,
              portfolioPublishedAt: projectTracks.portfolioPublishedAt,
            })
            .from(projectTracks)
            .where(eq(projectTracks.id, trackId))
            .limit(1)
            .for("update");
          const currentArtistApprovalAction =
            lockedPurchase && lockedTrack
              ? await currentTrackArtistApprovalAction(tx, {
                  trackId,
                  purchaseId: lockedPurchase.id,
                  producerId: ctx.producerId,
                })
              : null;
          assertActiveVersionUploadLifecycle(
            lockedPurchase && lockedTrack
              ? {
                  producerId: lockedProject.producerId,
                  projectId: lockedTrack.projectId,
                  purchaseId: lockedTrack.purchaseId,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                  trackArchivedAt: lockedTrack.archivedAt,
                  currentArtistApprovalAction,
                }
              : null,
            { producerId: ctx.producerId, projectId, purchaseId: discoveredTrack.purchaseId },
          );
          if (
            !lockedPurchase ||
            !lockedTrack ||
            lockedPurchase.producerId !== ctx.producerId ||
            lockedPurchase.projectId !== projectId ||
            lockedTrack.projectId !== projectId ||
            lockedTrack.purchaseId !== lockedPurchase.id
          ) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version upload scope was not found",
            );
          }
          const [publicLink] = await tx
            .select({ disabledAt: songPublicLinks.disabledAt })
            .from(songPublicLinks)
            .where(
              and(
                eq(songPublicLinks.trackId, trackId),
                eq(songPublicLinks.purchaseId, lockedPurchase.id),
                eq(songPublicLinks.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          requireSongUploadPublicExposureAcknowledgement({
            linkEnabled: publicLink?.disabledAt === null,
            portfolioPublished: lockedTrack.portfolioPublishedAt !== null,
            acknowledged: normalized.acknowledgePublicExposure,
          });
          const values = {
            createsTrack: false,
            projectId,
            purchaseId: lockedPurchase.id,
            trackId,
            title: lockedTrack.title,
            artist: lockedTrack.artist,
            label: normalized.label,
            description: normalized.description,
            durationMs: normalized.durationMs,
          };
          binding = {
            ...values,
            finalizationDigest: createAudioFinalizationDigest(values),
          };
        }

        const [updated] = await tx
          .update(firstVersionUploadIntents)
          .set({ ...binding, updatedAt: sql`now()` })
          .where(
            and(
              eq(firstVersionUploadIntents.id, lockedIntent.id),
              eq(firstVersionUploadIntents.producerId, ctx.producerId),
              isNull(firstVersionUploadIntents.finalizationDigest),
              isNull(firstVersionUploadIntents.completedAt),
              isNull(firstVersionUploadIntents.canceledAt),
            ),
          )
          .returning();
        if (!updated) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "The upload changed while its final details were being saved",
          );
        }
        assertBoundAudioUploadIntent(updated);
        assertFinalizeInputMatchesBinding(updated, normalized);
        return updated;
      });

      assertBoundAudioUploadIntent(boundIntent);
      assertFinalizeInputMatchesBinding(boundIntent, normalized);

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
        assertBoundAudioUploadIntent(lockedIntent);
        assertFinalizeInputMatchesBinding(lockedIntent, normalized);

        if (lockedIntent.completedAt) {
          let completedIntent = lockedIntent;
          if (!lockedIntent.stagingSealedAt) {
            await sealFirstVersionIntentStorage(lockedIntent);
            const [sealed] = await tx
              .update(firstVersionUploadIntents)
              .set({ stagingSealedAt: sql`now()`, updatedAt: sql`now()` })
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
            assertBoundAudioUploadIntent(sealed);
            completedIntent = sealed;
          }
          return { intent: completedIntent, newlyCompleted: false, terminalError: null };
        }

        const intentExpired = await databaseTimeHasPassed(tx, lockedIntent.expiresAt);
        if (lockedIntent.canceledAt || intentExpired) {
          if (!lockedIntent.stagingSealedAt) {
            await reconcileFirstVersionFinalDeletion(firstVersionFinalIdentity(lockedIntent));
            await sealFirstVersionIntentStorage(lockedIntent);
            const [sealed] = await tx
              .update(firstVersionUploadIntents)
              .set({ stagingSealedAt: sql`now()`, updatedAt: sql`now()` })
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
            newlyCompleted: false,
            terminalError: lockedIntent.canceledAt
              ? ({ code: "CANCELED" as const, message: "This upload was canceled." } as const)
              : ({ code: "EXPIRED" as const, message: "This upload expired." } as const),
          };
        }

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

        if (lockedIntent.createsTrack) {
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
        } else {
          const [lockedTrack] = await tx
            .select({
              id: projectTracks.id,
              projectId: projectTracks.projectId,
              purchaseId: projectTracks.purchaseId,
              archivedAt: projectTracks.archivedAt,
              portfolioPublishedAt: projectTracks.portfolioPublishedAt,
            })
            .from(projectTracks)
            .where(eq(projectTracks.id, lockedIntent.trackId))
            .limit(1)
            .for("update");
          const currentArtistApprovalAction =
            lockedPurchase && lockedTrack
              ? await currentTrackArtistApprovalAction(tx, {
                  trackId: lockedIntent.trackId,
                  purchaseId: lockedIntent.purchaseId,
                  producerId: ctx.producerId,
                })
              : null;
          assertActiveVersionUploadLifecycle(
            lockedProject && lockedPurchase && lockedTrack
              ? {
                  producerId: lockedProject.producerId,
                  projectId: lockedTrack.projectId,
                  purchaseId: lockedTrack.purchaseId,
                  projectLifecycleStatus: lockedProject.lifecycleStatus,
                  purchaseLifecycleStatus: lockedPurchase.lifecycleStatus,
                  trackArchivedAt: lockedTrack.archivedAt,
                  currentArtistApprovalAction,
                }
              : null,
            {
              producerId: ctx.producerId,
              projectId: lockedIntent.projectId,
              purchaseId: lockedIntent.purchaseId,
            },
          );
          if (
            !lockedPurchase ||
            !lockedTrack ||
            lockedPurchase.producerId !== ctx.producerId ||
            lockedPurchase.projectId !== lockedIntent.projectId ||
            lockedTrack.projectId !== lockedIntent.projectId ||
            lockedTrack.purchaseId !== lockedIntent.purchaseId
          ) {
            throw new VersionUploadDomainError(
              "NOT_FOUND",
              "The purchase-owned version upload scope was not found",
            );
          }
          const [publicLink] = await tx
            .select({ disabledAt: songPublicLinks.disabledAt })
            .from(songPublicLinks)
            .where(
              and(
                eq(songPublicLinks.trackId, lockedIntent.trackId),
                eq(songPublicLinks.purchaseId, lockedIntent.purchaseId),
                eq(songPublicLinks.producerId, ctx.producerId),
              ),
            )
            .limit(1)
            .for("update");
          requireSongUploadPublicExposureAcknowledgement({
            linkEnabled: publicLink?.disabledAt === null,
            portfolioPublished: lockedTrack.portfolioPublishedAt !== null,
            acknowledged: normalized.acknowledgePublicExposure,
          });
        }

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

        if (lockedIntent.createsTrack) {
          const [positionRow] = await tx
            .select({ position: sql<number>`coalesce(max(${projectTracks.position}), -1) + 1` })
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
        }
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
          uploadedAt: sql`now()`,
        });
        const [updatedIntent] = await tx
          .update(firstVersionUploadIntents)
          .set({ completedAt: sql`now()`, stagingSealedAt: sql`now()`, updatedAt: sql`now()` })
          .where(
            and(
              eq(firstVersionUploadIntents.id, lockedIntent.id),
              eq(firstVersionUploadIntents.producerId, ctx.producerId),
              eq(firstVersionUploadIntents.finalizationDigest, lockedIntent.finalizationDigest),
              isNull(firstVersionUploadIntents.completedAt),
              isNull(firstVersionUploadIntents.canceledAt),
            ),
          )
          .returning();
        if (!updatedIntent) {
          throw new FirstVersionUploadError(
            "CONFLICT",
            "The upload changed before it could be saved",
          );
        }
        assertBoundAudioUploadIntent(updatedIntent);
        await tx
          .update(projects)
          .set({ updatedAt: sql`now()` })
          .where(
            and(eq(projects.id, lockedIntent.projectId), eq(projects.producerId, ctx.producerId)),
          );
        return { intent: updatedIntent, newlyCompleted: true, terminalError: null };
      });

      if (completed.terminalError) {
        throw new FirstVersionUploadError(
          completed.terminalError.code,
          completed.terminalError.message,
        );
      }
      assertBoundAudioUploadIntent(completed.intent);
      if (completed.newlyCompleted) {
        scheduleStagedAudioArtistDelivery(ctx.db, ctx.producerId, completed.intent);
      }
      return {
        projectId: completed.intent.projectId,
        trackId: completed.intent.trackId,
        versionId: completed.intent.versionId,
        url: privateVersionStreamPath(completed.intent.versionId),
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
          const [selectedIntent] = await tx
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
          if (!selectedIntent) {
            throw new FirstVersionUploadError("NOT_FOUND", "The upload intent was not found");
          }
          const lockedIntent = await upgradeLegacyIntentIfNeeded(
            tx,
            ctx.producerId,
            selectedIntent,
            selectedIntent.requestDigest,
          );
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
              assertLegacyFirstVersionIntent(sealed, sealed.requestDigest);
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
          message:
            "This older upload cannot be cleared safely yet. Contact support before retrying.",
        });
      }
      return { ok: true as const, completed: Boolean(intent?.completedAt) };
    }),
});
