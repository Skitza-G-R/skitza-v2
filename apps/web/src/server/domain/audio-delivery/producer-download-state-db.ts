import {
  and,
  clientContacts,
  desc,
  eq,
  inArray,
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
import { AudioDeliveryDomainError, type AudioDeliveryContext } from "./policy";
import type {
  ProducerDownloadStateBatchRepository,
  ProducerDownloadStateBatchScope,
} from "./producer-download-state";
import { privateVersionStreamPath } from "./urls";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DiscoveredBatchScope = Readonly<{
  projectId: string;
  producerId: string;
  trackId: string;
  purchaseId: string;
  versionIds: readonly string[];
}>;

function notFound(): never {
  throw new AudioDeliveryDomainError("NOT_FOUND", "Audio was not found");
}

function validateRepositoryScope(scope: ProducerDownloadStateBatchScope): void {
  if (scope.versionIds.length === 0 || new Set(scope.versionIds).size !== scope.versionIds.length) {
    throw new AudioDeliveryDomainError(
      "INVALID_INPUT",
      "Batch version ids must be nonempty and unique",
    );
  }
}

async function discoverBatchScope(
  tx: TransactionDb,
  scope: ProducerDownloadStateBatchScope,
): Promise<DiscoveredBatchScope> {
  const rows = await tx
    .select({
      projectId: projectTracks.projectId,
      producerId: trackVersions.producerId,
      trackId: trackVersions.trackId,
      purchaseId: trackVersions.purchaseId,
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
    .where(
      and(
        eq(trackVersions.producerId, scope.producerId),
        eq(trackVersions.trackId, scope.trackId),
        eq(trackVersions.purchaseId, scope.purchaseId),
        inArray(trackVersions.id, [...scope.versionIds]),
      ),
    );

  if (rows.length !== scope.versionIds.length) notFound();
  const requestedVersionIds = new Set(scope.versionIds);
  const discoveredVersionIds = new Set(rows.map((row) => row.versionId));
  const projectIds = new Set(rows.map((row) => row.projectId));
  if (
    discoveredVersionIds.size !== requestedVersionIds.size ||
    [...requestedVersionIds].some((versionId) => !discoveredVersionIds.has(versionId)) ||
    projectIds.size !== 1
  ) {
    notFound();
  }
  const projectId = rows[0]?.projectId;
  if (!projectId) notFound();
  return {
    projectId,
    producerId: scope.producerId,
    trackId: scope.trackId,
    purchaseId: scope.purchaseId,
    versionIds: scope.versionIds,
  };
}

async function lockBatchScope(tx: TransactionDb, scope: DiscoveredBatchScope): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(scope.projectId)}, 0))`,
  );
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope.purchaseId}, 0))`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLedgerAdvisoryLockKey(scope.purchaseId)}, 0))`,
  );
}

async function loadLockedBatchRows(
  tx: TransactionDb,
  scope: ProducerDownloadStateBatchScope,
  discovered: DiscoveredBatchScope,
) {
  const rows = await tx
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
    .innerJoin(
      producers,
      and(
        eq(producers.id, purchases.producerId),
        eq(producers.clerkUserId, scope.actorClerkUserId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .where(
      and(
        eq(trackVersions.producerId, scope.producerId),
        eq(trackVersions.trackId, scope.trackId),
        eq(trackVersions.purchaseId, scope.purchaseId),
        eq(projectTracks.projectId, discovered.projectId),
        inArray(trackVersions.id, [...scope.versionIds]),
      ),
    )
    .for("share");

  if (rows.length !== scope.versionIds.length) notFound();
  const rowsByVersionId = new Map(rows.map((row) => [row.versionId, row]));
  if (
    rowsByVersionId.size !== scope.versionIds.length ||
    scope.versionIds.some((versionId) => !rowsByVersionId.has(versionId))
  ) {
    notFound();
  }
  return rowsByVersionId;
}

async function loadLatestOverrides(tx: TransactionDb, scope: ProducerDownloadStateBatchScope) {
  const rows = await tx
    .selectDistinctOn([purchaseDownloadOverrideEvents.versionId], {
      purchaseId: purchaseDownloadOverrideEvents.purchaseId,
      versionId: purchaseDownloadOverrideEvents.versionId,
      enabled: purchaseDownloadOverrideEvents.enabled,
      sequence: purchaseDownloadOverrideEvents.sequence,
    })
    .from(purchaseDownloadOverrideEvents)
    .where(
      and(
        eq(purchaseDownloadOverrideEvents.producerId, scope.producerId),
        eq(purchaseDownloadOverrideEvents.purchaseId, scope.purchaseId),
        inArray(purchaseDownloadOverrideEvents.versionId, [...scope.versionIds]),
      ),
    )
    .orderBy(
      purchaseDownloadOverrideEvents.versionId,
      desc(purchaseDownloadOverrideEvents.sequence),
    );
  return new Map(rows.map((row) => [row.versionId, row]));
}

export function producerDownloadStateBatchRepository(db: Db): ProducerDownloadStateBatchRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        validateRepositoryScope(scope);
        const discovered = await discoverBatchScope(tx, scope);
        await lockBatchScope(tx, discovered);
        const rowsByVersionId = await loadLockedBatchRows(tx, scope, discovered);
        const ledger = await readPurchaseLedger(
          purchaseLedgerRepositoryForTransaction(tx, {
            producerId: scope.producerId,
            purchaseId: scope.purchaseId,
          }),
          {
            producerId: scope.producerId,
            purchaseId: scope.purchaseId,
            asOf: new Date(),
          },
        );
        const overridesByVersionId = await loadLatestOverrides(tx, scope);

        const contexts = scope.versionIds.map((versionId): AudioDeliveryContext => {
          const row = rowsByVersionId.get(versionId);
          if (!row) notFound();
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
            ledger: ledger.projection,
            latestOverride: overridesByVersionId.get(versionId) ?? null,
          };
        });
        return work(contexts);
      }),
  };
}
