import {
  and,
  asc,
  clientContacts,
  eq,
  isNull,
  producers,
  projectTracks,
  projects,
  purchases,
  songPublicAccessEvents,
  songPublicLinks,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { selectPublicStoredVersions, type PublicStoredVersionCandidate } from "./read-model";
import type {
  SongPublicAccessAuditEvent,
  SongPublicationAtomicScope,
  SongPublicationRepository,
  SongPublicationSnapshot,
  SongPublicationTrackRecord,
  SongPublicationTransaction,
  SongPublicLinkRecord,
} from "./service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DiscoveredSongScope = Readonly<{
  projectId: string;
  purchaseId: string;
  trackId: string;
}>;

type LockedSongScope = DiscoveredSongScope &
  Readonly<{
    producerId: string;
    projectUpdatedAt: Date;
    portfolioPublishedAt: Date | null;
    writesAllowed: boolean;
  }>;

type SongPublicationRepositoryAuthorization = Readonly<{
  artistClerkUserId: string;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function unavailableTransaction(): SongPublicationTransaction {
  return {
    loadSnapshot: () => Promise.resolve(null),
    findEventByOperationKey: () => Promise.resolve(null),
    insertLink: () => Promise.resolve(null),
    updateLink: () => Promise.resolve(null),
    setPortfolioPublishedAt: () => Promise.resolve(null),
    appendAuditEvent: () => Promise.resolve(null),
  };
}

async function discoverSongScope(
  tx: TransactionDb,
  scope: SongPublicationAtomicScope,
): Promise<DiscoveredSongScope | null> {
  if (!UUID_PATTERN.test(scope.producerId) || !UUID_PATTERN.test(scope.trackId)) return null;

  const [row] = await tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      trackId: projectTracks.id,
    })
    .from(projectTracks)
    .innerJoin(
      projects,
      and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, scope.producerId)),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, scope.producerId),
        eq(purchases.clientContactId, projects.clientContactId),
      ),
    )
    .where(and(eq(projectTracks.id, scope.trackId), eq(projects.producerId, scope.producerId)))
    .limit(1);
  return row ?? null;
}

/**
 * Keep this lock order identical to song/version deletion: raw project UUID,
 * then raw purchase UUID. Both writers must serialize before either locks rows.
 */
async function lockCoreSongScope(
  tx: TransactionDb,
  scope: SongPublicationAtomicScope,
  discovered: DiscoveredSongScope,
  authorization?: SongPublicationRepositoryAuthorization,
): Promise<LockedSongScope | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${discovered.projectId}, 0))`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${discovered.purchaseId}, 0))`,
  );

  const [project] = await tx
    .select({
      id: projects.id,
      producerId: projects.producerId,
      clientContactId: projects.clientContactId,
      lifecycleStatus: projects.lifecycleStatus,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.id, discovered.projectId), eq(projects.producerId, scope.producerId)))
    .limit(1)
    .for("update");
  const [purchase] = await tx
    .select({
      id: purchases.id,
      projectId: purchases.projectId,
      producerId: purchases.producerId,
      clientContactId: purchases.clientContactId,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.id, discovered.purchaseId),
        eq(purchases.projectId, discovered.projectId),
        eq(purchases.producerId, scope.producerId),
      ),
    )
    .limit(1)
    .for("update");
  const [track] = await tx
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      portfolioPublishedAt: projectTracks.portfolioPublishedAt,
    })
    .from(projectTracks)
    .where(
      and(
        eq(projectTracks.id, discovered.trackId),
        eq(projectTracks.projectId, discovered.projectId),
        eq(projectTracks.purchaseId, discovered.purchaseId),
      ),
    )
    .limit(1)
    .for("update");

  if (
    !project ||
    !purchase ||
    !track ||
    project.producerId !== scope.producerId ||
    purchase.producerId !== scope.producerId ||
    purchase.projectId !== project.id ||
    purchase.clientContactId !== project.clientContactId ||
    track.projectId !== project.id ||
    track.purchaseId !== purchase.id
  ) {
    return null;
  }

  // Producer and Artist commands share this repository. Always serialize a
  // new publication write with studio closure, while retaining the locked
  // snapshot and immutable events needed for an exact committed replay.
  const [producer] = await tx
    .select({ id: producers.id, closedAt: producers.closedAt })
    .from(producers)
    .where(eq(producers.id, project.producerId))
    .limit(1)
    .for("share");
  if (!producer) return null;
  const writesAllowed = producer.closedAt === null;

  if (authorization) {
    if (project.lifecycleStatus === "waiting_for_payment") return null;
    const [contact] = await tx
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, project.clientContactId),
          eq(clientContacts.producerId, project.producerId),
          eq(clientContacts.clerkUserId, authorization.artistClerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .limit(1)
      .for("share");
    if (!contact) return null;
  }

  return {
    projectId: project.id,
    purchaseId: purchase.id,
    producerId: scope.producerId,
    trackId: track.id,
    projectUpdatedAt: project.updatedAt,
    portfolioPublishedAt: track.portfolioPublishedAt,
    writesAllowed,
  };
}

function versionSelection() {
  return {
    id: trackVersions.id,
    trackId: trackVersions.trackId,
    purchaseId: trackVersions.purchaseId,
    producerId: trackVersions.producerId,
    label: trackVersions.label,
    durationMs: trackVersions.durationMs,
    peaks: trackVersions.peaks,
    uploadedAt: trackVersions.uploadedAt,
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
  };
}

function linkSelection() {
  return {
    id: songPublicLinks.id,
    trackId: songPublicLinks.trackId,
    purchaseId: songPublicLinks.purchaseId,
    producerId: songPublicLinks.producerId,
    tokenVersion: songPublicLinks.tokenVersion,
    tokenHash: songPublicLinks.tokenHash,
    enabledAt: songPublicLinks.enabledAt,
    disabledAt: songPublicLinks.disabledAt,
    createdAt: songPublicLinks.createdAt,
    updatedAt: songPublicLinks.updatedAt,
  };
}

function eventSelection() {
  return {
    trackId: songPublicAccessEvents.trackId,
    purchaseId: songPublicAccessEvents.purchaseId,
    producerId: songPublicAccessEvents.producerId,
    linkId: songPublicAccessEvents.linkId,
    versionId: songPublicAccessEvents.versionId,
    action: songPublicAccessEvents.action,
    sequence: songPublicAccessEvents.sequence,
    tokenVersion: songPublicAccessEvents.tokenVersion,
    tokenHash: songPublicAccessEvents.tokenHash,
    linkEnabled: songPublicAccessEvents.linkEnabled,
    portfolioPublished: songPublicAccessEvents.portfolioPublished,
    remainingAudioCount: songPublicAccessEvents.remainingAudioCount,
    operationKey: songPublicAccessEvents.operationKey,
    operationDigest: songPublicAccessEvents.operationDigest,
    changedByClerkUserId: songPublicAccessEvents.changedByClerkUserId,
    changed: songPublicAccessEvents.changed,
    createdAt: songPublicAccessEvents.createdAt,
  };
}

type SelectedAuditEvent = Omit<SongPublicAccessAuditEvent, "action"> & { action: string };

function auditEventFromRow(row: SelectedAuditEvent): SongPublicAccessAuditEvent {
  return { ...row, action: row.action as SongPublicAccessAuditEvent["action"] };
}

async function lockVersions(
  tx: TransactionDb,
  scope: LockedSongScope,
): Promise<PublicStoredVersionCandidate[]> {
  return tx
    .select(versionSelection())
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.trackId, scope.trackId),
        eq(trackVersions.purchaseId, scope.purchaseId),
        eq(trackVersions.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(trackVersions.id))
    .for("update");
}

async function lockLink(
  tx: TransactionDb,
  scope: LockedSongScope,
): Promise<SongPublicLinkRecord | null> {
  const [link] = await tx
    .select(linkSelection())
    .from(songPublicLinks)
    .where(
      and(
        eq(songPublicLinks.trackId, scope.trackId),
        eq(songPublicLinks.purchaseId, scope.purchaseId),
        eq(songPublicLinks.producerId, scope.producerId),
      ),
    )
    .limit(1)
    .for("update");
  return link ?? null;
}

async function lockAuditEvents(
  tx: TransactionDb,
  scope: LockedSongScope,
): Promise<SongPublicAccessAuditEvent[]> {
  const rows = await tx
    .select(eventSelection())
    .from(songPublicAccessEvents)
    .where(
      and(
        eq(songPublicAccessEvents.trackId, scope.trackId),
        eq(songPublicAccessEvents.purchaseId, scope.purchaseId),
        eq(songPublicAccessEvents.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(songPublicAccessEvents.sequence), asc(songPublicAccessEvents.id))
    .for("update");
  return rows.map((row) => auditEventFromRow(row));
}

function exactLinkScope(input: SongPublicLinkRecord, scope: LockedSongScope): boolean {
  return (
    input.trackId === scope.trackId &&
    input.purchaseId === scope.purchaseId &&
    input.producerId === scope.producerId
  );
}

function exactEventScope(input: SongPublicAccessAuditEvent, scope: LockedSongScope): boolean {
  return (
    input.trackId === scope.trackId &&
    input.purchaseId === scope.purchaseId &&
    input.producerId === scope.producerId
  );
}

function transactionAdapter(
  tx: TransactionDb,
  scope: LockedSongScope,
  snapshot: SongPublicationSnapshot,
  events: readonly SongPublicAccessAuditEvent[],
): SongPublicationTransaction {
  return {
    loadSnapshot: () => Promise.resolve(snapshot),
    findEventByOperationKey: (operationKey) =>
      Promise.resolve(events.find((event) => event.operationKey === operationKey) ?? null),
    insertLink: async (input) => {
      if (!exactLinkScope(input, scope)) return null;
      const [inserted] = await tx
        .insert(songPublicLinks)
        .values({
          id: input.id,
          trackId: input.trackId,
          purchaseId: input.purchaseId,
          producerId: input.producerId,
          tokenVersion: input.tokenVersion,
          tokenHash: input.tokenHash,
          enabledAt: input.enabledAt,
          disabledAt: input.disabledAt,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .onConflictDoNothing()
        .returning(linkSelection());
      return inserted ?? null;
    },
    updateLink: async (input) => {
      if (input.next.id !== input.linkId || !exactLinkScope(input.next, scope)) return null;
      const [updated] = await tx
        .update(songPublicLinks)
        .set({
          tokenVersion: input.next.tokenVersion,
          tokenHash: input.next.tokenHash,
          enabledAt: input.next.enabledAt,
          disabledAt: input.next.disabledAt,
          updatedAt: input.next.updatedAt,
        })
        .where(
          and(
            eq(songPublicLinks.id, input.linkId),
            eq(songPublicLinks.trackId, scope.trackId),
            eq(songPublicLinks.purchaseId, scope.purchaseId),
            eq(songPublicLinks.producerId, scope.producerId),
            eq(songPublicLinks.tokenVersion, input.expectedTokenVersion),
            input.expectedDisabledAt === null
              ? isNull(songPublicLinks.disabledAt)
              : eq(songPublicLinks.disabledAt, input.expectedDisabledAt),
          ),
        )
        .returning(linkSelection());
      return updated ?? null;
    },
    setPortfolioPublishedAt: async (input) => {
      const [updated] = await tx
        .update(projectTracks)
        .set({ portfolioPublishedAt: input.portfolioPublishedAt })
        .where(
          and(
            eq(projectTracks.id, scope.trackId),
            eq(projectTracks.projectId, scope.projectId),
            eq(projectTracks.purchaseId, scope.purchaseId),
            input.expectedPortfolioPublishedAt === null
              ? isNull(projectTracks.portfolioPublishedAt)
              : eq(projectTracks.portfolioPublishedAt, input.expectedPortfolioPublishedAt),
          ),
        )
        .returning({
          id: projectTracks.id,
          purchaseId: projectTracks.purchaseId,
          portfolioPublishedAt: projectTracks.portfolioPublishedAt,
        });
      if (!updated) return null;

      const [touched] = await tx
        .update(projects)
        .set({ updatedAt: input.changedAt })
        .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)))
        .returning({ id: projects.id });
      if (!touched) throw new Error("The public song project could not be updated");

      return {
        id: updated.id,
        purchaseId: updated.purchaseId,
        producerId: scope.producerId,
        portfolioPublishedAt: updated.portfolioPublishedAt,
      } satisfies SongPublicationTrackRecord;
    },
    appendAuditEvent: async (event) => {
      if (!exactEventScope(event, scope)) return null;
      const [inserted] = await tx
        .insert(songPublicAccessEvents)
        .values({
          trackId: event.trackId,
          purchaseId: event.purchaseId,
          producerId: event.producerId,
          linkId: event.linkId,
          versionId: event.versionId,
          action: event.action,
          sequence: event.sequence,
          tokenVersion: event.tokenVersion,
          tokenHash: event.tokenHash,
          changed: event.changed,
          linkEnabled: event.linkEnabled,
          portfolioPublished: event.portfolioPublished,
          remainingAudioCount: event.remainingAudioCount,
          operationKey: event.operationKey,
          operationDigest: event.operationDigest,
          changedByClerkUserId: event.changedByClerkUserId,
          createdAt: event.createdAt,
        })
        .onConflictDoNothing()
        .returning(eventSelection());
      return inserted ? auditEventFromRow(inserted) : null;
    },
  };
}

/**
 * A closed Producer may receive an exact retry of an operation that
 * committed before closure. Keep only the snapshot and immutable audit lookup
 * available so that replay succeeds without permitting any new publication
 * state or audit event to be written.
 */
function replayOnlyTransaction(
  transaction: SongPublicationTransaction,
): SongPublicationTransaction {
  return {
    loadSnapshot: () => transaction.loadSnapshot(),
    findEventByOperationKey: (operationKey) => transaction.findEventByOperationKey(operationKey),
    insertLink: () => Promise.resolve(null),
    updateLink: () => Promise.resolve(null),
    setPortfolioPublishedAt: () => Promise.resolve(null),
    appendAuditEvent: () => Promise.resolve(null),
  };
}

export function songPublicationRepository(
  db: Db,
  authorization?: SongPublicationRepositoryAuthorization,
): SongPublicationRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        const discovered = await discoverSongScope(tx, scope);
        if (!discovered) return work(unavailableTransaction());

        const locked = await lockCoreSongScope(tx, scope, discovered, authorization);
        if (!locked) return work(unavailableTransaction());

        // Row locks always follow the core project/purchase/track order.
        const versions = await lockVersions(tx, locked);
        const link = await lockLink(tx, locked);
        const events = await lockAuditEvents(tx, locked);
        const snapshot: SongPublicationSnapshot = {
          track: {
            id: locked.trackId,
            purchaseId: locked.purchaseId,
            producerId: locked.producerId,
            portfolioPublishedAt: locked.portfolioPublishedAt,
          },
          projectUpdatedAt: locked.projectUpdatedAt,
          link,
          remainingAudioCount: selectPublicStoredVersions(versions, locked).length,
          lastEventSequence: events.at(-1)?.sequence ?? 0,
          lastEventCreatedAt: events.at(-1)?.createdAt ?? null,
        };
        const transaction = transactionAdapter(tx, locked, snapshot, events);
        return work(locked.writesAllowed ? transaction : replayOnlyTransaction(transaction));
      }),
  };
}
