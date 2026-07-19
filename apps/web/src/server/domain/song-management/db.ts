import {
  and,
  desc,
  eq,
  isNull,
  or,
  portfolioTracks,
  projects,
  projectTracks,
  purchases,
  songPublicLinks,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { isAudioKeyForTrackVersion } from "~/server/storage/r2";

import {
  assertStoredAudioDeletionAllowed,
  normalizeArtistCredit,
  normalizeSongTitle,
  normalizeVersionLabel,
  planSongArchiveChange,
  requireHistorySafeStoredAudioIdentity,
  SongManagementDomainError,
  type StoredAudioIdentity,
} from "./service";

type SongScope = Readonly<{
  projectId: string;
  purchaseId: string;
  trackId: string;
}>;

type WorkflowStage = "brief" | "production" | "mixing" | "mastering" | "done";

type LockedSong = Readonly<{
  id: string;
  projectId: string;
  purchaseId: string;
  title: string;
  artist: string | null;
  workflowStage: WorkflowStage;
  releasedAt: Date | null;
  archivedAt: Date | null;
  portfolioPublishedAt: Date | null;
}>;

function notFound(message = "The song was not found"): never {
  throw new SongManagementDomainError("NOT_FOUND", message);
}

function integrityError(message: string): never {
  throw new SongManagementDomainError("INTEGRITY_ERROR", message);
}

async function discoverSongScope(
  db: Db,
  input: Readonly<{ producerId: string; trackId: string }>,
): Promise<SongScope> {
  const [scope] = await db
    .select({
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      trackId: projectTracks.id,
    })
    .from(projectTracks)
    .innerJoin(
      projects,
      and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, input.producerId)),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, input.producerId),
      ),
    )
    .where(and(eq(projectTracks.id, input.trackId), eq(projects.producerId, input.producerId)))
    .limit(1);
  if (!scope) notFound();
  return scope;
}

async function discoverVersionScope(
  db: Db,
  input: Readonly<{ producerId: string; versionId: string }>,
): Promise<SongScope> {
  const [scope] = await db
    .select({
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      trackId: projectTracks.id,
    })
    .from(trackVersions)
    .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
    .innerJoin(
      projects,
      and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, input.producerId)),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, input.producerId),
      ),
    )
    .where(
      and(eq(trackVersions.id, input.versionId), eq(trackVersions.producerId, input.producerId)),
    )
    .limit(1);
  if (!scope) notFound("The version was not found");
  return scope;
}

async function lockSong(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  input: Readonly<{ producerId: string; scope: SongScope }>,
): Promise<LockedSong> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.scope.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.scope.purchaseId}, 0))`,
  );

  const [project] = await tx
    .select({ id: projects.id, producerId: projects.producerId })
    .from(projects)
    .where(and(eq(projects.id, input.scope.projectId), eq(projects.producerId, input.producerId)))
    .limit(1)
    .for("update");
  const [purchase] = await tx
    .select({
      id: purchases.id,
      producerId: purchases.producerId,
      projectId: purchases.projectId,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.id, input.scope.purchaseId),
        eq(purchases.producerId, input.producerId),
        eq(purchases.projectId, input.scope.projectId),
      ),
    )
    .limit(1)
    .for("update");
  const [track] = await tx
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      title: projectTracks.title,
      artist: projectTracks.artist,
      workflowStage: projectTracks.workflowStage,
      releasedAt: projectTracks.releasedAt,
      archivedAt: projectTracks.archivedAt,
      portfolioPublishedAt: projectTracks.portfolioPublishedAt,
    })
    .from(projectTracks)
    .where(eq(projectTracks.id, input.scope.trackId))
    .limit(1)
    .for("update");

  if (
    !project ||
    !purchase ||
    !track ||
    project.producerId !== input.producerId ||
    purchase.producerId !== input.producerId ||
    purchase.projectId !== input.scope.projectId ||
    track.projectId !== input.scope.projectId ||
    track.purchaseId !== input.scope.purchaseId
  ) {
    notFound();
  }
  return track;
}

async function touchProject(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  input: Readonly<{ producerId: string; projectId: string; changedAt: Date }>,
): Promise<void> {
  const [updated] = await tx
    .update(projects)
    .set({ updatedAt: input.changedAt })
    .where(and(eq(projects.id, input.projectId), eq(projects.producerId, input.producerId)))
    .returning({ id: projects.id });
  if (!updated) integrityError("The song project changed while it was being updated");
}

export async function updateSongMetadata(
  db: Db,
  input: Readonly<{
    producerId: string;
    trackId: string;
    projectId?: string;
    title?: string;
    artist?: string | null;
    changedAt: Date;
  }>,
): Promise<LockedSong> {
  const title = input.title === undefined ? undefined : normalizeSongTitle(input.title);
  const artist = input.artist === undefined ? undefined : normalizeArtistCredit(input.artist);
  if (title === undefined && artist === undefined) {
    throw new SongManagementDomainError("INVALID_INPUT", "No song metadata change was supplied");
  }
  const scope = await discoverSongScope(db, input);
  if (input.projectId !== undefined && scope.projectId !== input.projectId) notFound();
  return db.transaction(async (tx) => {
    await lockSong(tx, { producerId: input.producerId, scope });
    const [updated] = await tx
      .update(projectTracks)
      .set({
        ...(title === undefined ? {} : { title }),
        ...(artist === undefined ? {} : { artist }),
      })
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .returning({
        id: projectTracks.id,
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
        title: projectTracks.title,
        artist: projectTracks.artist,
        workflowStage: projectTracks.workflowStage,
        releasedAt: projectTracks.releasedAt,
        archivedAt: projectTracks.archivedAt,
        portfolioPublishedAt: projectTracks.portfolioPublishedAt,
      });
    if (!updated) integrityError("The song changed while its metadata was being updated");
    const audioIdentities = await tx
      .select({
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
      })
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .for("update");
    for (const identity of audioIdentities) {
      if (identity.audioUrl === null && identity.audioR2Key === null) continue;
      await tx
        .update(portfolioTracks)
        .set({ title: updated.title, artist: updated.artist })
        .where(
          and(
            eq(portfolioTracks.producerId, input.producerId),
            or(
              ...(identity.audioR2Key === null
                ? []
                : [eq(portfolioTracks.audioR2Key, identity.audioR2Key)]),
              ...(identity.audioUrl === null
                ? []
                : [eq(portfolioTracks.audioUrl, identity.audioUrl)]),
            ),
          ),
        );
    }
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    return updated;
  });
}

export async function setSongArchiveState(
  db: Db,
  input: Readonly<{
    producerId: string;
    trackId: string;
    intent: "archive" | "restore";
    changedAt: Date;
  }>,
): Promise<Readonly<{ track: LockedSong; changed: boolean }>> {
  const scope = await discoverSongScope(db, input);
  return db.transaction(async (tx) => {
    const locked = await lockSong(tx, { producerId: input.producerId, scope });
    const plan = planSongArchiveChange({
      currentArchivedAt: locked.archivedAt,
      intent: input.intent,
      changedAt: input.changedAt,
    });
    if (!plan.changed) return { track: locked, changed: false };
    const [updated] = await tx
      .update(projectTracks)
      .set({ archivedAt: plan.nextArchivedAt })
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .returning({
        id: projectTracks.id,
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
        title: projectTracks.title,
        artist: projectTracks.artist,
        workflowStage: projectTracks.workflowStage,
        releasedAt: projectTracks.releasedAt,
        archivedAt: projectTracks.archivedAt,
        portfolioPublishedAt: projectTracks.portfolioPublishedAt,
      });
    if (!updated) integrityError("The song changed while its archive state was being updated");
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    return { track: updated, changed: true };
  });
}

export async function renameSongVersion(
  db: Db,
  input: Readonly<{
    producerId: string;
    versionId: string;
    projectId?: string;
    label: string;
    changedAt: Date;
  }>,
): Promise<Readonly<{ id: string; label: string }>> {
  const label = normalizeVersionLabel(input.label);
  const scope = await discoverVersionScope(db, input);
  if (input.projectId !== undefined && scope.projectId !== input.projectId) {
    notFound("The version was not found");
  }
  return db.transaction(async (tx) => {
    await lockSong(tx, { producerId: input.producerId, scope });
    const [lockedVersion] = await tx
      .select({ id: trackVersions.id, trackId: trackVersions.trackId })
      .from(trackVersions)
      .where(
        and(eq(trackVersions.id, input.versionId), eq(trackVersions.producerId, input.producerId)),
      )
      .limit(1)
      .for("update");
    if (!lockedVersion || lockedVersion.trackId !== scope.trackId)
      notFound("The version was not found");
    const [updated] = await tx
      .update(trackVersions)
      .set({ label })
      .where(
        and(
          eq(trackVersions.id, input.versionId),
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .returning({ id: trackVersions.id, label: trackVersions.label });
    if (!updated) integrityError("The version changed while it was being renamed");
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    return updated;
  });
}

export async function setProducerFinalVersion(
  db: Db,
  input: Readonly<{
    producerId: string;
    versionId: string;
    markedFinal: boolean;
    changedAt: Date;
  }>,
): Promise<Readonly<{ markedFinalAt: Date | null }>> {
  const scope = await discoverVersionScope(db, input);
  return db.transaction(async (tx) => {
    await lockSong(tx, { producerId: input.producerId, scope });
    const versions = await tx
      .select({
        id: trackVersions.id,
        trackId: trackVersions.trackId,
        audioUrl: trackVersions.audioUrl,
        audioDeletedAt: trackVersions.audioDeletedAt,
      })
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .for("update");
    const target = versions.find((version) => version.id === input.versionId);
    if (!target || target.trackId !== scope.trackId) notFound("The version was not found");
    if (input.markedFinal && (target.audioUrl === null || target.audioDeletedAt !== null)) {
      throw new SongManagementDomainError(
        "INVALID_INPUT",
        "Deleted or incomplete audio cannot be marked final",
      );
    }
    const markedFinalAt = input.markedFinal ? input.changedAt : null;
    if (input.markedFinal) {
      await tx
        .update(trackVersions)
        .set({ producerMarkedFinalAt: null })
        .where(
          and(
            eq(trackVersions.trackId, scope.trackId),
            eq(trackVersions.producerId, input.producerId),
          ),
        );
    }
    const [updated] = await tx
      .update(trackVersions)
      .set({ producerMarkedFinalAt: markedFinalAt })
      .where(
        and(
          eq(trackVersions.id, input.versionId),
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.producerId, input.producerId),
          ...(input.markedFinal ? [isNull(trackVersions.audioDeletedAt)] : []),
        ),
      )
      .returning({ id: trackVersions.id });
    if (!updated) integrityError("The version changed while final selection was being updated");
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    return { markedFinalAt };
  });
}

export async function setSongWorkflowStage(
  db: Db,
  input: Readonly<{
    producerId: string;
    trackId: string;
    workflowStage: WorkflowStage;
    changedAt: Date;
  }>,
): Promise<Readonly<{ workflowStage: WorkflowStage }>> {
  const scope = await discoverSongScope(db, input);
  return db.transaction(async (tx) => {
    await lockSong(tx, { producerId: input.producerId, scope });
    const [updated] = await tx
      .update(projectTracks)
      .set({ workflowStage: input.workflowStage })
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .returning({ workflowStage: projectTracks.workflowStage });
    if (!updated) integrityError("The song changed while its stage was being updated");
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.changedAt,
    });
    return updated;
  });
}

/**
 * Marks the song Released once. Release is deliberately independent from the
 * Done / Delivered workflow stage and cannot be cleared: stored final or last
 * audio may be permanently deleted after this timestamp is committed.
 */
export async function markSongReleased(
  db: Db,
  input: Readonly<{ producerId: string; trackId: string; releasedAt: Date }>,
): Promise<Readonly<{ releasedAt: Date; changed: boolean }>> {
  const scope = await discoverSongScope(db, input);
  return db.transaction(async (tx) => {
    const track = await lockSong(tx, { producerId: input.producerId, scope });
    if (track.releasedAt !== null) {
      return { releasedAt: track.releasedAt, changed: false };
    }
    const [updated] = await tx
      .update(projectTracks)
      .set({ releasedAt: input.releasedAt })
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
          isNull(projectTracks.releasedAt),
        ),
      )
      .returning({ releasedAt: projectTracks.releasedAt });
    if (!updated?.releasedAt) {
      integrityError("The song changed while it was being marked Released");
    }
    await touchProject(tx, {
      producerId: input.producerId,
      projectId: scope.projectId,
      changedAt: input.releasedAt,
    });
    return { releasedAt: updated.releasedAt, changed: true };
  });
}

/**
 * Publishes one producer-owned live song version without trusting browser-sent
 * audio metadata. The shared song lock makes this mutually exclusive with an
 * audio tombstone, so a stale Library picker can never recreate a public row
 * after the stored object has been revoked.
 */
export async function createPortfolioTrackFromSongVersion(
  db: Db,
  input: Readonly<{ producerId: string; versionId: string }>,
): Promise<typeof portfolioTracks.$inferSelect> {
  const scope = await discoverVersionScope(db, input);
  return db.transaction(async (tx) => {
    const track = await lockSong(tx, { producerId: input.producerId, scope });
    const [version] = await tx
      .select({
        id: trackVersions.id,
        trackId: trackVersions.trackId,
        purchaseId: trackVersions.purchaseId,
        producerId: trackVersions.producerId,
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
        sizeBytes: trackVersions.sizeBytes,
        audioObjectEtag: trackVersions.audioObjectEtag,
        audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
        durationMs: trackVersions.durationMs,
        peaksR2Key: trackVersions.peaksR2Key,
        audioDeletedAt: trackVersions.audioDeletedAt,
      })
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.id, input.versionId),
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.purchaseId, scope.purchaseId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !version ||
      version.trackId !== scope.trackId ||
      version.purchaseId !== scope.purchaseId ||
      version.producerId !== input.producerId ||
      version.audioDeletedAt !== null ||
      version.audioUrl === null
    ) {
      notFound("The live version was not found");
    }

    const identity = requireHistorySafeStoredAudioIdentity({
      key: version.audioR2Key,
      objectEtag: version.audioObjectEtag,
      sizeBytes: version.sizeBytes,
      fingerprint: version.audioIdentityFingerprint,
    });
    if (
      !isAudioKeyForTrackVersion(identity.key, {
        producerId: input.producerId,
        trackVersionId: input.versionId,
      })
    ) {
      integrityError("The retained audio key does not belong to this producer version");
    }

    const [duplicate] = await tx
      .select({ id: portfolioTracks.id })
      .from(portfolioTracks)
      .where(
        and(
          eq(portfolioTracks.producerId, input.producerId),
          or(
            eq(portfolioTracks.audioR2Key, identity.key),
            eq(portfolioTracks.audioUrl, version.audioUrl),
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (duplicate) {
      throw new SongManagementDomainError(
        "INVALID_INPUT",
        "This track is already in your portfolio",
      );
    }

    const [created] = await tx
      .insert(portfolioTracks)
      .values({
        producerId: input.producerId,
        title: track.title,
        artist: track.artist,
        audioUrl: version.audioUrl,
        audioR2Key: identity.key,
        sizeBytes: identity.sizeBytes,
        durationMs: version.durationMs,
        peaksR2Key: version.peaksR2Key,
        isPublicSample: true,
      })
      .returning();
    if (!created) integrityError("The live song version could not be added to the portfolio");
    return created;
  });
}

export type TombstoneStoredAudioResult = Readonly<{
  versionId: string;
  trackId: string;
  projectId: string;
  identity: StoredAudioIdentity;
  alreadyTombstoned: boolean;
  isReleased: boolean;
  wasCurrent: boolean;
  wasProducerFinal: boolean;
  wasLastStoredAudio: boolean;
  nextPlaybackVersionId: string | null;
}>;

/**
 * Revokes every database read path before R2 reconciliation. A retry sees the
 * retained immutable identity and safely finishes the same exact object.
 */
export async function tombstoneStoredAudioVersion(
  db: Db,
  input: Readonly<{ producerId: string; versionId: string; deletedAt: Date }>,
): Promise<TombstoneStoredAudioResult> {
  const scope = await discoverVersionScope(db, input);
  return db.transaction(async (tx) => {
    const track = await lockSong(tx, { producerId: input.producerId, scope });
    const versions = await tx
      .select({
        id: trackVersions.id,
        trackId: trackVersions.trackId,
        audioUrl: trackVersions.audioUrl,
        audioR2Key: trackVersions.audioR2Key,
        sizeBytes: trackVersions.sizeBytes,
        audioObjectEtag: trackVersions.audioObjectEtag,
        audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
        durationMs: trackVersions.durationMs,
        peaksR2Key: trackVersions.peaksR2Key,
        uploadedAt: trackVersions.uploadedAt,
        producerMarkedFinalAt: trackVersions.producerMarkedFinalAt,
        audioDeletedAt: trackVersions.audioDeletedAt,
      })
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .orderBy(desc(trackVersions.uploadedAt), desc(trackVersions.id))
      .for("update");
    const target = versions.find((version) => version.id === input.versionId);
    if (!target || target.trackId !== scope.trackId)
      notFound("The stored audio version was not found");
    if (target.audioUrl === null) {
      throw new SongManagementDomainError(
        "INVALID_INPUT",
        "Only completed stored audio can be permanently deleted from this path",
      );
    }

    const identity = requireHistorySafeStoredAudioIdentity({
      key: target.audioR2Key,
      objectEtag: target.audioObjectEtag,
      sizeBytes: target.sizeBytes,
      fingerprint: target.audioIdentityFingerprint,
    });
    if (
      !isAudioKeyForTrackVersion(identity.key, {
        producerId: input.producerId,
        trackVersionId: input.versionId,
      })
    ) {
      integrityError("The retained audio key does not belong to this producer version");
    }

    const storedVersions = versions.filter(
      (version) => version.audioDeletedAt === null && version.audioUrl !== null,
    );
    const orderedStoredIds = storedVersions.map((version) => version.id);
    const targetStoredIndex = orderedStoredIds.indexOf(input.versionId);
    const alreadyTombstoned = target.audioDeletedAt !== null;
    const isReleased = track.releasedAt !== null;
    let nextPlaybackVersionId = orderedStoredIds.find((id) => id !== input.versionId) ?? null;
    let wasCurrent = targetStoredIndex === 0;
    let wasLastStoredAudio = storedVersions.length === 1 && targetStoredIndex === 0;

    if (!alreadyTombstoned) {
      const decision = assertStoredAudioDeletionAllowed({
        targetVersionId: input.versionId,
        isReleased,
        storedVersions: storedVersions.map((version) => ({
          versionId: version.id,
          uploadedAt: version.uploadedAt,
          producerMarkedFinalAt: version.producerMarkedFinalAt,
        })),
      });
      nextPlaybackVersionId = decision.nextPlaybackVersionId;
      const [tombstoned] = await tx
        .update(trackVersions)
        .set({ audioDeletedAt: input.deletedAt })
        .where(
          and(
            eq(trackVersions.id, input.versionId),
            eq(trackVersions.trackId, scope.trackId),
            eq(trackVersions.producerId, input.producerId),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .returning({ id: trackVersions.id });
      if (!tombstoned) integrityError("The stored audio changed while deletion was authorized");

      const portfolioIdentityMatch = and(
        eq(portfolioTracks.producerId, input.producerId),
        or(
          eq(portfolioTracks.audioR2Key, identity.key),
          eq(portfolioTracks.audioUrl, target.audioUrl),
        ),
      );
      const nextVersion =
        nextPlaybackVersionId === null
          ? null
          : (versions.find((version) => version.id === nextPlaybackVersionId) ?? null);
      if (nextVersion) {
        if (
          nextVersion.audioDeletedAt !== null ||
          nextVersion.audioUrl === null ||
          nextVersion.audioR2Key === null ||
          nextVersion.sizeBytes === null
        ) {
          integrityError("The selected playback fallback is not stored audio");
        }
        await tx
          .update(portfolioTracks)
          .set({
            title: track.title,
            artist: track.artist,
            audioUrl: nextVersion.audioUrl,
            audioR2Key: nextVersion.audioR2Key,
            sizeBytes: nextVersion.sizeBytes,
            durationMs: nextVersion.durationMs,
            peaksR2Key: nextVersion.peaksR2Key,
          })
          .where(portfolioIdentityMatch);
      } else {
        await tx.delete(portfolioTracks).where(portfolioIdentityMatch);
        await tx
          .update(projectTracks)
          .set({ portfolioPublishedAt: null })
          .where(
            and(
              eq(projectTracks.id, scope.trackId),
              eq(projectTracks.projectId, scope.projectId),
              eq(projectTracks.purchaseId, scope.purchaseId),
            ),
          );
        await tx
          .update(songPublicLinks)
          .set({ disabledAt: input.deletedAt, updatedAt: input.deletedAt })
          .where(
            and(
              eq(songPublicLinks.trackId, scope.trackId),
              eq(songPublicLinks.purchaseId, scope.purchaseId),
              eq(songPublicLinks.producerId, input.producerId),
              isNull(songPublicLinks.disabledAt),
            ),
          );
      }

      await touchProject(tx, {
        producerId: input.producerId,
        projectId: scope.projectId,
        changedAt: input.deletedAt,
      });
    } else {
      // The policy was already authorized by the committed tombstone. Derive
      // only current fallback state; a retry must never re-open that decision.
      wasCurrent = false;
      wasLastStoredAudio = storedVersions.length === 0;
    }

    return {
      versionId: input.versionId,
      trackId: scope.trackId,
      projectId: scope.projectId,
      identity,
      alreadyTombstoned,
      isReleased,
      wasCurrent,
      wasProducerFinal: target.producerMarkedFinalAt !== null,
      wasLastStoredAudio,
      nextPlaybackVersionId,
    };
  });
}
