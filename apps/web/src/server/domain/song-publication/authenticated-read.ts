import {
  and,
  asc,
  clientContacts,
  eq,
  isNull,
  projectTracks,
  projects,
  purchases,
  songPublicLinks,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";

import {
  selectPublicStoredVersions,
  type PublicSongScope,
  type PublicStoredVersionCandidate,
} from "./read-model";
import type { SongPublicationState } from "./service";
import { buildSongPublicPath, createSongPublicToken, hashSongPublicToken } from "./tokens";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type AuthenticatedStateInput = Readonly<{ trackId: string; tokenSecret: string }> &
  (
    | Readonly<{ producerId: string; artistClerkUserId?: never }>
    | Readonly<{ producerId?: never; artistClerkUserId: string }>
  );

type DiscoveredAuthenticatedScope = Readonly<{
  projectId: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  trackId: string;
}>;

type LockedAuthenticatedScope = DiscoveredAuthenticatedScope &
  Readonly<{ portfolioPublishedAt: Date | null }>;

export class SongPublicationAuthenticatedReadError extends Error {
  constructor(readonly code: "NOT_FOUND" | "INTEGRITY_ERROR") {
    super(code === "NOT_FOUND" ? "Song publication was not found" : "Song publication is invalid");
    this.name = "SongPublicationAuthenticatedReadError";
  }
}

export type ProducerPortfolioSongChoice = Readonly<{
  trackId: string;
  title: string;
  artist: string | null;
  projectTitle: string;
  projectArtistName: string;
  portfolioPublishedAt: Date | null;
  latestVersion: Readonly<{
    id: string;
    label: string;
    audioUrl: string;
    durationMs: number | null;
    peaks: number[] | null;
    uploadedAt: Date;
  }>;
}>;

export type ProducerPortfolioTrackCandidate = PublicSongScope &
  Readonly<{
    title: string;
    artist: string | null;
    projectTitle: string;
    projectArtistName: string;
    portfolioPublishedAt: Date | null;
  }>;

/**
 * Builds one producer-dashboard row from the same strict stored-audio policy
 * used by anonymous portfolio reads. Returning null removes a song whose last
 * valid audio was deleted instead of preserving a copied/stale preview URL.
 */
export function selectProducerPortfolioSongChoice(
  track: ProducerPortfolioTrackCandidate,
  candidates: readonly PublicStoredVersionCandidate[],
): ProducerPortfolioSongChoice | null {
  const latest = selectPublicStoredVersions(candidates, track)[0];
  if (!latest) return null;
  return {
    trackId: track.trackId,
    title: track.title,
    artist: track.artist,
    projectTitle: track.projectTitle,
    projectArtistName: track.projectArtistName,
    portfolioPublishedAt: track.portfolioPublishedAt,
    latestVersion: {
      ...latest,
      audioUrl: privateVersionStreamPath(latest.id),
    },
  };
}

function notFound(): never {
  throw new SongPublicationAuthenticatedReadError("NOT_FOUND");
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

function authenticatedScopeSelection() {
  return {
    projectId: projects.id,
    purchaseId: purchases.id,
    producerId: projects.producerId,
    clientContactId: projects.clientContactId,
    trackId: projectTracks.id,
  };
}

async function discoverAuthenticatedScope(
  tx: TransactionDb,
  input: AuthenticatedStateInput,
): Promise<DiscoveredAuthenticatedScope | null> {
  const base = tx
    .select(authenticatedScopeSelection())
    .from(projectTracks)
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, projects.producerId),
        eq(purchases.clientContactId, projects.clientContactId),
      ),
    );

  if (input.producerId !== undefined) {
    const [scope] = await base
      .where(
        and(
          eq(projectTracks.id, input.trackId),
          eq(projects.producerId, input.producerId),
          eq(purchases.producerId, input.producerId),
        ),
      )
      .limit(1);
    return scope ?? null;
  }

  const [scope] = await base
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
      ),
    )
    .where(
      and(
        eq(projectTracks.id, input.trackId),
        eq(clientContacts.clerkUserId, input.artistClerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  return scope ?? null;
}

async function lockAuthenticatedScope(
  tx: TransactionDb,
  discovered: DiscoveredAuthenticatedScope,
  input: AuthenticatedStateInput,
): Promise<LockedAuthenticatedScope | null> {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${discovered.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${discovered.purchaseId}, 0))`,
  );

  const [project] = await tx
    .select({
      id: projects.id,
      producerId: projects.producerId,
      clientContactId: projects.clientContactId,
    })
    .from(projects)
    .where(eq(projects.id, discovered.projectId))
    .limit(1)
    .for("share");
  const [purchase] = await tx
    .select({
      id: purchases.id,
      projectId: purchases.projectId,
      producerId: purchases.producerId,
      clientContactId: purchases.clientContactId,
    })
    .from(purchases)
    .where(eq(purchases.id, discovered.purchaseId))
    .limit(1)
    .for("share");
  const [track] = await tx
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      portfolioPublishedAt: projectTracks.portfolioPublishedAt,
    })
    .from(projectTracks)
    .where(eq(projectTracks.id, discovered.trackId))
    .limit(1)
    .for("share");

  if (
    !project ||
    !purchase ||
    !track ||
    project.id !== discovered.projectId ||
    project.producerId !== discovered.producerId ||
    project.clientContactId !== discovered.clientContactId ||
    purchase.id !== discovered.purchaseId ||
    purchase.projectId !== project.id ||
    purchase.producerId !== project.producerId ||
    purchase.clientContactId !== project.clientContactId ||
    track.id !== discovered.trackId ||
    track.projectId !== project.id ||
    track.purchaseId !== purchase.id ||
    (input.producerId !== undefined && project.producerId !== input.producerId)
  ) {
    return null;
  }

  if (input.artistClerkUserId !== undefined) {
    const [contact] = await tx
      .select({
        id: clientContacts.id,
        producerId: clientContacts.producerId,
        clerkUserId: clientContacts.clerkUserId,
        archivedAt: clientContacts.archivedAt,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, project.clientContactId),
          eq(clientContacts.producerId, project.producerId),
          eq(clientContacts.clerkUserId, input.artistClerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .limit(1)
      .for("share");
    if (
      !contact ||
      contact.id !== project.clientContactId ||
      contact.producerId !== project.producerId ||
      contact.clerkUserId !== input.artistClerkUserId ||
      contact.archivedAt !== null
    ) {
      return null;
    }
  }

  return {
    projectId: project.id,
    purchaseId: purchase.id,
    producerId: project.producerId,
    clientContactId: project.clientContactId,
    trackId: track.id,
    portfolioPublishedAt: track.portfolioPublishedAt,
  };
}

async function stateForOwnedTrack(
  db: Db,
  input: AuthenticatedStateInput,
): Promise<SongPublicationState> {
  return db.transaction(async (tx) => {
    const discovered = await discoverAuthenticatedScope(tx, input);
    if (!discovered) notFound();
    const scope = await lockAuthenticatedScope(tx, discovered, input);
    if (!scope) notFound();

    const candidates: PublicStoredVersionCandidate[] = await tx
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
      .for("share");
    const [link] = await tx
      .select({
        id: songPublicLinks.id,
        tokenVersion: songPublicLinks.tokenVersion,
        tokenHash: songPublicLinks.tokenHash,
        disabledAt: songPublicLinks.disabledAt,
      })
      .from(songPublicLinks)
      .where(
        and(
          eq(songPublicLinks.trackId, scope.trackId),
          eq(songPublicLinks.purchaseId, scope.purchaseId),
          eq(songPublicLinks.producerId, scope.producerId),
        ),
      )
      .limit(1)
      .for("share");

    const remainingAudioCount = selectPublicStoredVersions(candidates, scope).length;
    const portfolioPublished =
      scope.portfolioPublishedAt !== null && remainingAudioCount > 0;
    if (!link) {
      return {
        trackId: scope.trackId,
        purchaseId: scope.purchaseId,
        producerId: scope.producerId,
        linkId: null,
        linkEnabled: false,
        portfolioPublished,
        remainingAudioCount,
        tokenVersion: null,
        tokenHash: null,
        publicUrl: null,
      };
    }

    const token = createSongPublicToken(input.tokenSecret, {
      linkId: link.id,
      tokenVersion: link.tokenVersion,
    });
    if (hashSongPublicToken(token) !== link.tokenHash) {
      throw new SongPublicationAuthenticatedReadError("INTEGRITY_ERROR");
    }
    const linkEnabled = link.disabledAt === null && remainingAudioCount > 0;
    return {
      trackId: scope.trackId,
      purchaseId: scope.purchaseId,
      producerId: scope.producerId,
      linkId: link.id,
      linkEnabled,
      portfolioPublished,
      remainingAudioCount,
      tokenVersion: link.tokenVersion,
      tokenHash: link.tokenHash,
      publicUrl: linkEnabled ? buildSongPublicPath(token) : null,
    };
  });
}

export function readProducerSongPublicationState(
  db: Db,
  input: Readonly<{ producerId: string; trackId: string; tokenSecret: string }>,
): Promise<SongPublicationState> {
  return stateForOwnedTrack(db, input);
}

/**
 * Producer-only portfolio manager feed. It deliberately walks through songs
 * and immutable versions instead of the legacy portfolio_tracks snapshot.
 * Project lifecycle and song archive state are not filters: a producer's
 * explicit portfolio setting survives those transitions.
 */
export async function listProducerPortfolioSongChoices(
  db: Db,
  input: Readonly<{ producerId: string }>,
): Promise<ProducerPortfolioSongChoice[]> {
  const tracks: ProducerPortfolioTrackCandidate[] = await db
    .select({
      trackId: projectTracks.id,
      purchaseId: projectTracks.purchaseId,
      producerId: projects.producerId,
      title: projectTracks.title,
      artist: projectTracks.artist,
      projectTitle: projects.title,
      projectArtistName: projects.artistName,
      portfolioPublishedAt: projectTracks.portfolioPublishedAt,
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
    .where(eq(projects.producerId, input.producerId));

  const output: ProducerPortfolioSongChoice[] = [];
  for (const track of tracks) {
    const candidates: PublicStoredVersionCandidate[] = await db
      .select(versionSelection())
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, track.trackId),
          eq(trackVersions.purchaseId, track.purchaseId),
          eq(trackVersions.producerId, track.producerId),
        ),
      );
    const choice = selectProducerPortfolioSongChoice(track, candidates);
    if (choice) output.push(choice);
  }

  return output.sort((left, right) => {
    if (left.portfolioPublishedAt && right.portfolioPublishedAt) {
      const publishedOrder =
        right.portfolioPublishedAt.getTime() - left.portfolioPublishedAt.getTime();
      if (publishedOrder !== 0) return publishedOrder;
    } else if (left.portfolioPublishedAt) {
      return -1;
    } else if (right.portfolioPublishedAt) {
      return 1;
    }
    const uploadedOrder =
      right.latestVersion.uploadedAt.getTime() - left.latestVersion.uploadedAt.getTime();
    return uploadedOrder === 0
      ? right.latestVersion.id.localeCompare(left.latestVersion.id)
      : uploadedOrder;
  });
}

export async function readArtistSongPublicationState(
  db: Db,
  input: Readonly<{
    artistClerkUserId: string;
    trackId: string;
    tokenSecret: string;
  }>,
): Promise<SongPublicationState> {
  const state = await stateForOwnedTrack(db, input);
  if (!state.linkEnabled || state.publicUrl === null) notFound();
  return state;
}
