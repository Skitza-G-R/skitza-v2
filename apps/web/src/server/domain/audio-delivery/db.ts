import {
  and,
  clientContacts,
  desc,
  eq,
  portfolioTracks,
  projectTracks,
  projects,
  producers,
  purchaseDownloadOverrideEvents,
  purchases,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import {
  purchaseLedgerAdvisoryLockKey,
  purchaseLedgerRepositoryForTransaction,
} from "../purchase-ledger/db";
import { readPurchaseLedger } from "../purchase-ledger/service";
import {
  AudioDeliveryDomainError,
  type AudioDeliveryContext,
  type PublicAudioDeliveryContext,
} from "./policy";
import { privateVersionStreamPath, publicPortfolioStreamPath } from "./urls";
import type {
  AudioDeliveryRepository,
  AudioDeliveryScope,
  AudioDeliveryTransaction,
  DownloadOverrideEvent,
  NewDownloadOverrideEvent,
  PublicAudioDeliveryRepository,
} from "./service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DiscoveredVersionScope = Readonly<{
  projectId: string;
  purchaseId: string;
  producerId: string;
  trackId: string;
  versionId: string;
}>;

function notFound(): never {
  throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
}

async function discoverVersionScope(
  tx: TransactionDb,
  scope: Readonly<{ versionId: string; purchaseId?: string }>,
): Promise<DiscoveredVersionScope> {
  const where = [eq(trackVersions.id, scope.versionId)];
  if (scope.purchaseId !== undefined) where.push(eq(trackVersions.purchaseId, scope.purchaseId));
  const [row] = await tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: trackVersions.purchaseId,
      producerId: trackVersions.producerId,
      trackId: trackVersions.trackId,
      versionId: trackVersions.id,
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
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, trackVersions.producerId),
      ),
    )
    .where(and(...where))
    .limit(1);
  if (!row) notFound();
  return row;
}

async function lockScope(tx: TransactionDb, scope: DiscoveredVersionScope): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(scope.projectId)}, 0))`,
  );
  // Song deletion already uses the raw purchase id after the project lock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope.purchaseId}, 0))`);
  // Payments and corrections use this exact prefixed purchase lock.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLedgerAdvisoryLockKey(scope.purchaseId)}, 0))`,
  );
}

async function lockStoredVersionForDelivery(
  tx: TransactionDb,
  scope: DiscoveredVersionScope,
): Promise<void> {
  const [locked] = await tx
    .select({ id: trackVersions.id })
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.id, scope.versionId),
        eq(trackVersions.trackId, scope.trackId),
        eq(trackVersions.purchaseId, scope.purchaseId),
        eq(trackVersions.producerId, scope.producerId),
      ),
    )
    .limit(1)
    .for("share");
  if (!locked) notFound();
}

async function lockPublicPortfolioRow(
  tx: TransactionDb,
  portfolioTrackId: string,
  scope: DiscoveredVersionScope,
): Promise<void> {
  const [locked] = await tx
    .select({ id: portfolioTracks.id })
    .from(portfolioTracks)
    .where(
      and(
        eq(portfolioTracks.id, portfolioTrackId),
        eq(portfolioTracks.producerId, scope.producerId),
      ),
    )
    .limit(1)
    .for("share");
  if (!locked) notFound();
}

async function loadLockedContext(
  tx: TransactionDb,
  discovered: DiscoveredVersionScope,
  scope: AudioDeliveryScope,
): Promise<AudioDeliveryContext> {
  const [row] = await tx
    .select({
      producerId: producers.id,
      producerClerkUserId: producers.clerkUserId,
      projectId: projects.id,
      projectProducerId: projects.producerId,
      projectClientContactId: projects.clientContactId,
      purchaseId: purchases.id,
      purchaseProducerId: purchases.producerId,
      purchaseProjectId: purchases.projectId,
      purchaseClientContactId: purchases.clientContactId,
      purchaseCurrency: purchases.currency,
      artistId: clientContacts.id,
      artistProducerId: clientContacts.producerId,
      artistClerkUserId: clientContacts.clerkUserId,
      artistArchivedAt: clientContacts.archivedAt,
      trackId: projectTracks.id,
      trackProjectId: projectTracks.projectId,
      trackPurchaseId: projectTracks.purchaseId,
      trackTitle: projectTracks.title,
      versionId: trackVersions.id,
      versionProducerId: trackVersions.producerId,
      versionTrackId: trackVersions.trackId,
      versionPurchaseId: trackVersions.purchaseId,
      versionLabel: trackVersions.label,
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
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, trackVersions.producerId),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, purchases.projectId),
        eq(projects.producerId, purchases.producerId),
        eq(projects.clientContactId, purchases.clientContactId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchases.producerId))
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .where(
      and(
        eq(trackVersions.id, discovered.versionId),
        eq(trackVersions.trackId, discovered.trackId),
        eq(trackVersions.purchaseId, discovered.purchaseId),
        eq(trackVersions.producerId, discovered.producerId),
        eq(projectTracks.projectId, discovered.projectId),
      ),
    )
    .limit(1);
  if (!row) notFound();

  const commercial =
    scope.kind === "commercial"
      ? {
          ledger: await readPurchaseLedger(
            purchaseLedgerRepositoryForTransaction(tx, {
              producerId: discovered.producerId,
              purchaseId: discovered.purchaseId,
            }),
            {
              producerId: discovered.producerId,
              purchaseId: discovered.purchaseId,
              asOf: new Date(),
            },
          ),
          latestOverride: await tx
            .select({
              purchaseId: purchaseDownloadOverrideEvents.purchaseId,
              versionId: purchaseDownloadOverrideEvents.versionId,
              enabled: purchaseDownloadOverrideEvents.enabled,
              sequence: purchaseDownloadOverrideEvents.sequence,
            })
            .from(purchaseDownloadOverrideEvents)
            .where(
              and(
                eq(purchaseDownloadOverrideEvents.purchaseId, discovered.purchaseId),
                eq(purchaseDownloadOverrideEvents.versionId, discovered.versionId),
                eq(purchaseDownloadOverrideEvents.producerId, discovered.producerId),
              ),
            )
            .orderBy(desc(purchaseDownloadOverrideEvents.sequence))
            .limit(1),
        }
      : null;

  return {
    producer: { id: row.producerId, clerkUserId: row.producerClerkUserId },
    project: {
      id: row.projectId,
      producerId: row.projectProducerId,
      clientContactId: row.projectClientContactId,
    },
    purchase: {
      id: row.purchaseId,
      producerId: row.purchaseProducerId,
      projectId: row.purchaseProjectId,
      clientContactId: row.purchaseClientContactId,
      currency: row.purchaseCurrency,
    },
    artist: {
      id: row.artistId,
      producerId: row.artistProducerId,
      clerkUserId: row.artistClerkUserId,
      archivedAt: row.artistArchivedAt,
    },
    song: {
      id: row.trackId,
      producerId: row.purchaseProducerId,
      projectId: row.trackProjectId,
      purchaseId: row.trackPurchaseId,
      title: row.trackTitle,
    },
    version: {
      id: row.versionId,
      producerId: row.versionProducerId,
      trackId: row.versionTrackId,
      purchaseId: row.versionPurchaseId,
      label: row.versionLabel,
    },
    storedAudio: {
      versionId: row.versionId,
      producerId: row.versionProducerId,
      protectedAudioUrl: row.audioUrl,
      expectedProtectedAudioUrl: privateVersionStreamPath(row.versionId),
      key: row.audioR2Key,
      objectEtag: row.audioObjectEtag,
      sizeBytes: row.sizeBytes,
      fingerprint: row.audioIdentityFingerprint,
      deletedAt: row.audioDeletedAt,
      pendingFieldsAreClear:
        row.pendingAudioR2Key === null &&
        row.pendingAudioUploadId === null &&
        row.pendingAudioInitiationDigest === null &&
        row.pendingAudioCompletionToken === null &&
        row.pendingAudioSizeBytes === null &&
        row.pendingAudioStartedAt === null &&
        row.pendingAudioCreateAttemptedAt === null &&
        row.pendingAudioCompleteAttemptedAt === null &&
        row.pendingAudioPartUrlsExpireAt === null &&
        row.pendingAudioCancelRequestedAt === null &&
        row.pendingAudioCleanupEtag === null,
    },
    ledger: commercial?.ledger.projection ?? null,
    latestOverride: commercial?.latestOverride[0] ?? null,
  };
}

function overrideRecord(
  row: typeof purchaseDownloadOverrideEvents.$inferSelect,
): DownloadOverrideEvent {
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    versionId: row.versionId,
    producerId: row.producerId,
    sequence: row.sequence,
    operationKey: row.operationKey,
    operationDigest: row.operationDigest,
    enabled: row.enabled,
    changedByClerkUserId: row.changedByClerkUserId,
    createdAt: row.createdAt,
  };
}

function transactionAdapter(
  tx: TransactionDb,
  context: AudioDeliveryContext,
): AudioDeliveryTransaction {
  return {
    context,
    findOverrideOperation: async (operationKey) => {
      const [row] = await tx
        .select()
        .from(purchaseDownloadOverrideEvents)
        .where(
          and(
            eq(purchaseDownloadOverrideEvents.purchaseId, context.purchase.id),
            eq(purchaseDownloadOverrideEvents.operationKey, operationKey),
          ),
        )
        .limit(1);
      return row ? overrideRecord(row) : null;
    },
    appendOverride: async (input: NewDownloadOverrideEvent) => {
      const [row] = await tx.insert(purchaseDownloadOverrideEvents).values(input).returning();
      if (!row) {
        throw new AudioDeliveryDomainError(
          "INTEGRITY_ERROR",
          "The override audit event was not stored",
        );
      }
      return overrideRecord(row);
    },
  };
}

export function audioDeliveryRepository(db: Db): AudioDeliveryRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        const discovered = await discoverVersionScope(tx, scope);
        if (scope.kind === "commercial") await lockScope(tx, discovered);
        await lockStoredVersionForDelivery(tx, discovered);
        const context = await loadLockedContext(tx, discovered, scope);
        return work(transactionAdapter(tx, context));
      }),
  };
}

async function discoverPublicSampleScope(
  tx: TransactionDb,
  portfolioTrackId: string,
): Promise<DiscoveredVersionScope> {
  const [row] = await tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: trackVersions.purchaseId,
      producerId: trackVersions.producerId,
      trackId: trackVersions.trackId,
      versionId: trackVersions.id,
    })
    .from(portfolioTracks)
    .innerJoin(
      trackVersions,
      and(
        eq(trackVersions.producerId, portfolioTracks.producerId),
        eq(trackVersions.audioR2Key, portfolioTracks.audioR2Key),
      ),
    )
    .innerJoin(
      projectTracks,
      and(
        eq(projectTracks.id, trackVersions.trackId),
        eq(projectTracks.purchaseId, trackVersions.purchaseId),
      ),
    )
    .where(eq(portfolioTracks.id, portfolioTrackId))
    .limit(1);
  if (!row) notFound();
  return row;
}

async function loadLockedPublicContext(
  tx: TransactionDb,
  portfolioTrackId: string,
  scope: DiscoveredVersionScope,
): Promise<PublicAudioDeliveryContext> {
  const [row] = await tx
    .select({
      portfolioTrackId: portfolioTracks.id,
      portfolioProducerId: portfolioTracks.producerId,
      portfolioTitle: portfolioTracks.title,
      portfolioAudioUrl: portfolioTracks.audioUrl,
      portfolioAudioR2Key: portfolioTracks.audioR2Key,
      portfolioSizeBytes: portfolioTracks.sizeBytes,
      isPublicSample: portfolioTracks.isPublicSample,
      versionId: trackVersions.id,
      versionProducerId: trackVersions.producerId,
      versionLabel: trackVersions.label,
      versionAudioR2Key: trackVersions.audioR2Key,
      versionSizeBytes: trackVersions.sizeBytes,
      versionObjectEtag: trackVersions.audioObjectEtag,
      versionFingerprint: trackVersions.audioIdentityFingerprint,
      versionDeletedAt: trackVersions.audioDeletedAt,
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
    .from(portfolioTracks)
    .innerJoin(
      trackVersions,
      and(
        eq(trackVersions.id, scope.versionId),
        eq(trackVersions.producerId, portfolioTracks.producerId),
        eq(trackVersions.audioR2Key, portfolioTracks.audioR2Key),
      ),
    )
    .innerJoin(
      projectTracks,
      and(
        eq(projectTracks.id, trackVersions.trackId),
        eq(projectTracks.purchaseId, trackVersions.purchaseId),
        eq(projectTracks.projectId, scope.projectId),
      ),
    )
    .where(
      and(
        eq(portfolioTracks.id, portfolioTrackId),
        eq(portfolioTracks.producerId, scope.producerId),
        eq(trackVersions.purchaseId, scope.purchaseId),
      ),
    )
    .limit(1);
  if (!row) notFound();
  return {
    portfolioTrack: {
      id: row.portfolioTrackId,
      producerId: row.portfolioProducerId,
      audioUrl: row.portfolioAudioUrl,
      expectedAudioUrl: publicPortfolioStreamPath(row.portfolioTrackId),
      audioR2Key: row.portfolioAudioR2Key,
      sizeBytes: row.portfolioSizeBytes,
      isPublicSample: row.isPublicSample,
      title: row.portfolioTitle,
    },
    version: {
      id: row.versionId,
      producerId: row.versionProducerId,
      audioR2Key: row.versionAudioR2Key,
      sizeBytes: row.versionSizeBytes,
      audioObjectEtag: row.versionObjectEtag,
      audioIdentityFingerprint: row.versionFingerprint,
      audioDeletedAt: row.versionDeletedAt,
      label: row.versionLabel,
      pendingFieldsAreClear:
        row.pendingAudioR2Key === null &&
        row.pendingAudioUploadId === null &&
        row.pendingAudioInitiationDigest === null &&
        row.pendingAudioCompletionToken === null &&
        row.pendingAudioSizeBytes === null &&
        row.pendingAudioStartedAt === null &&
        row.pendingAudioCreateAttemptedAt === null &&
        row.pendingAudioCompleteAttemptedAt === null &&
        row.pendingAudioPartUrlsExpireAt === null &&
        row.pendingAudioCancelRequestedAt === null &&
        row.pendingAudioCleanupEtag === null,
    },
  };
}

export function publicAudioDeliveryRepository(db: Db): PublicAudioDeliveryRepository {
  return {
    atomically: (portfolioTrackId, work) =>
      db.transaction(async (tx) => {
        const scope = await discoverPublicSampleScope(tx, portfolioTrackId);
        // Public listening never depends on money or override state. The exact
        // version/portfolio row locks below serialize only with audio deletion
        // and retargeting, without letting anonymous Range traffic queue behind
        // payment and correction locks.
        await lockStoredVersionForDelivery(tx, scope);
        await lockPublicPortfolioRow(tx, portfolioTrackId, scope);
        const context = await loadLockedPublicContext(tx, portfolioTrackId, scope);
        return work(context);
      }),
  };
}
