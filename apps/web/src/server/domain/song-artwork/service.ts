import {
  and,
  clientContacts,
  eq,
  isNull,
  projectTracks,
  projects,
  songDeletionOperations,
  sql,
  type Db,
} from "@skitza/db";

import { lockProducerAudioStorageQuota } from "~/server/domain/audio-storage/quota";
import {
  lockProducerCapabilityState,
  type LockedProducerCapabilityState,
} from "~/server/domain/producer-capabilities/open-state";
import {
  resolveCapabilitySecret,
  type CapabilityVerificationSecrets,
} from "~/server/security/capability-secrets";
import {
  assertSongArtworkUploadMetadata,
  normalizeSongArtworkFileName,
  SongArtworkPolicyError,
  type SongArtworkContentType,
} from "./policy";
import {
  createPrivateSongArtworkUpload,
  deleteSongArtworkObjectQuietly,
  finalizePrivateSongArtworkUpload,
  SongArtworkStorageError,
  type FinalizedSongArtworkObject,
} from "./storage";
import {
  createSongArtworkUploadToken,
  songArtworkObjectKeys,
  songArtworkRevisionFingerprint,
  SongArtworkTokenError,
  type SongArtworkRevisionIdentity,
  verifyOwnedSongArtworkUploadToken,
} from "./tokens";
import { privateSongArtworkPath } from "./urls";

export type SongArtworkDomainErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT";

export class SongArtworkDomainError extends Error {
  constructor(
    readonly code: SongArtworkDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SongArtworkDomainError";
  }
}

type SongArtworkStoragePort = Readonly<{
  createUpload: typeof createPrivateSongArtworkUpload;
  finalizeUpload: typeof finalizePrivateSongArtworkUpload;
  deleteObjectQuietly: typeof deleteSongArtworkObjectQuietly;
}>;

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];
type SongArtworkQueryDb = Db | TransactionDb;

const defaultStorage: SongArtworkStoragePort = {
  createUpload: createPrivateSongArtworkUpload,
  finalizeUpload: finalizePrivateSongArtworkUpload,
  deleteObjectQuietly: deleteSongArtworkObjectQuietly,
};

function requireSongArtworkProducerOpen(producer: LockedProducerCapabilityState | null): void {
  if (!producer || producer.closedAt !== null) {
    throw new SongArtworkDomainError("NOT_FOUND", "Song was not found");
  }
}

function mapBoundaryError(error: unknown): never {
  if (error instanceof SongArtworkDomainError) throw error;
  if (error instanceof SongArtworkPolicyError || error instanceof SongArtworkTokenError) {
    throw new SongArtworkDomainError("INVALID_INPUT", error.message);
  }
  if (error instanceof SongArtworkStorageError) {
    throw new SongArtworkDomainError("CONFLICT", error.message);
  }
  throw error;
}

type OwnedSongArtwork = Readonly<{
  id: string;
  artworkR2Key: string | null;
  artworkContentType: string | null;
  artworkSizeBytes: number | null;
  artworkObjectEtag: string | null;
}>;

function currentArtworkIdentity(row: OwnedSongArtwork): SongArtworkRevisionIdentity {
  const allMissing =
    row.artworkR2Key === null &&
    row.artworkContentType === null &&
    row.artworkSizeBytes === null &&
    row.artworkObjectEtag === null;
  if (allMissing) return null;
  if (
    !row.artworkR2Key ||
    !row.artworkContentType ||
    row.artworkSizeBytes === null ||
    !row.artworkObjectEtag
  ) {
    throw new SongArtworkDomainError("CONFLICT", "Song artwork data is incomplete");
  }
  const metadata = {
    contentType: row.artworkContentType,
    sizeBytes: row.artworkSizeBytes,
  };
  try {
    assertSongArtworkUploadMetadata(metadata);
  } catch {
    throw new SongArtworkDomainError("CONFLICT", "Song artwork data is invalid");
  }
  return {
    storageKey: row.artworkR2Key,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    objectEtag: row.artworkObjectEtag,
  };
}

async function loadProducerOwnedSong(
  db: SongArtworkQueryDb,
  input: { producerId: string; trackId: string },
): Promise<OwnedSongArtwork> {
  const [row] = await db
    .select({
      id: projectTracks.id,
      artworkR2Key: projectTracks.artworkR2Key,
      artworkContentType: projectTracks.artworkContentType,
      artworkSizeBytes: projectTracks.artworkSizeBytes,
      artworkObjectEtag: projectTracks.artworkObjectEtag,
    })
    .from(projectTracks)
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .where(and(eq(projectTracks.id, input.trackId), eq(projects.producerId, input.producerId)))
    .limit(1);
  if (!row) throw new SongArtworkDomainError("NOT_FOUND", "Song was not found");
  return row;
}

async function assertNoPendingSongDeletion(
  db: SongArtworkQueryDb,
  input: { producerId: string; trackId: string },
): Promise<void> {
  const [pending] = await db
    .select({ id: songDeletionOperations.id })
    .from(songDeletionOperations)
    .where(
      and(
        eq(songDeletionOperations.producerId, input.producerId),
        eq(songDeletionOperations.trackId, input.trackId),
        isNull(songDeletionOperations.completedAt),
      ),
    )
    .limit(1);
  if (pending) {
    throw new SongArtworkDomainError("CONFLICT", "This Song is being permanently deleted");
  }
}

export async function prepareProducerSongArtwork(
  db: Db,
  input: {
    producerId: string;
    trackId: string;
    originalFileName: string;
    contentType: SongArtworkContentType;
    sizeBytes: number;
    serverSecret: string;
    now?: Date | undefined;
  },
  storage: SongArtworkStoragePort = defaultStorage,
): Promise<{
  uploadUrl: string;
  uploadToken: string;
  expiresInSeconds: number;
}> {
  try {
    const originalFileName = normalizeSongArtworkFileName(input.originalFileName);
    assertSongArtworkUploadMetadata({
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    return await db.transaction(async (tx) => {
      await lockProducerAudioStorageQuota(tx, input.producerId);
      requireSongArtworkProducerOpen(await lockProducerCapabilityState(tx, input.producerId));
      const song = await loadProducerOwnedSong(tx, input);
      await assertNoPendingSongDeletion(tx, input);
      const signed = createSongArtworkUploadToken(
        input.serverSecret,
        {
          baseRevision: songArtworkRevisionFingerprint(
            input.serverSecret,
            currentArtworkIdentity(song),
          ),
          producerId: input.producerId,
          trackId: input.trackId,
          originalFileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        },
        input.now,
      );
      const upload = await storage.createUpload(input.serverSecret, signed.payload);
      return { ...upload, uploadToken: signed.token };
    });
  } catch (error) {
    mapBoundaryError(error);
  }
}

export async function completeProducerSongArtwork(
  db: Db,
  input: {
    producerId: string;
    trackId: string;
    uploadToken: string;
    objectEtag: string;
    serverSecret: CapabilityVerificationSecrets;
    now?: Date | undefined;
  },
  storage: SongArtworkStoragePort = defaultStorage,
): Promise<{ artworkUrl: string }> {
  try {
    const verified = resolveCapabilitySecret(input.serverSecret, (secret) =>
      verifyOwnedSongArtworkUploadToken(
        secret,
        input.uploadToken,
        { producerId: input.producerId, trackId: input.trackId },
        input.now,
      ),
    );
    const { secret: serverSecret, value: payload } = verified;
    const result = await db.transaction(async (tx) => {
      await lockProducerAudioStorageQuota(tx, input.producerId);
      const producer = await lockProducerCapabilityState(tx, input.producerId);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`song-artwork:${payload.trackId}`}, 0))`,
      );
      const [owned] = await tx
        .select({
          id: projectTracks.id,
          artworkR2Key: projectTracks.artworkR2Key,
          artworkContentType: projectTracks.artworkContentType,
          artworkSizeBytes: projectTracks.artworkSizeBytes,
          artworkObjectEtag: projectTracks.artworkObjectEtag,
        })
        .from(projectTracks)
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(eq(projectTracks.id, payload.trackId), eq(projects.producerId, input.producerId)),
        )
        .limit(1)
        .for("update");
      if (!owned) {
        throw new SongArtworkDomainError("NOT_FOUND", "Song was not found");
      }
      await assertNoPendingSongDeletion(tx, {
        producerId: input.producerId,
        trackId: payload.trackId,
      });
      const current = currentArtworkIdentity(owned);
      const { finalKey } = songArtworkObjectKeys(serverSecret, payload);
      if (
        current?.storageKey === finalKey &&
        current.contentType === payload.contentType &&
        current.sizeBytes === payload.sizeBytes
      ) {
        return { previousStorageKey: null, artwork: current };
      }
      requireSongArtworkProducerOpen(producer);
      if (songArtworkRevisionFingerprint(serverSecret, current) !== payload.baseRevision) {
        throw new SongArtworkDomainError(
          "CONFLICT",
          "The song cover changed. Choose the image again",
        );
      }
      const artwork: FinalizedSongArtworkObject = await storage.finalizeUpload(
        serverSecret,
        payload,
        input.objectEtag,
      );
      await tx
        .update(projectTracks)
        .set({
          artworkR2Key: artwork.storageKey,
          artworkContentType: artwork.contentType,
          artworkSizeBytes: artwork.sizeBytes,
          artworkObjectEtag: artwork.objectEtag,
        })
        .where(eq(projectTracks.id, payload.trackId));
      return {
        previousStorageKey: current?.storageKey ?? null,
        artwork,
      };
    });

    if (result.previousStorageKey && result.previousStorageKey !== result.artwork.storageKey) {
      await storage.deleteObjectQuietly(result.previousStorageKey);
    }
    // The authenticated route is stable, so add the signed upload attempt ID
    // after a replacement to make the existing <img> request the new bytes.
    return { artworkUrl: privateSongArtworkPath(payload.trackId, payload.uploadId) };
  } catch (error) {
    // Keep a finalized private object after an ambiguous database failure.
    // Deleting here could break a row whose transaction committed before the
    // client observed the result. An unreferenced private object is safer.
    mapBoundaryError(error);
  }
}

export type AuthorizedSongArtwork = Readonly<{
  storageKey: string;
  contentType: SongArtworkContentType;
  sizeBytes: number;
  objectEtag: string;
}>;

export type SongArtworkViewer =
  | Readonly<{ role: "producer"; producerId: string }>
  | Readonly<{ role: "artist"; clerkUserId: string }>;

/**
 * Resolve the exact private object only after current account ownership is
 * proven. Missing artwork and unauthorized viewers deliberately share the same
 * NOT_FOUND result.
 */
export async function authorizeSongArtworkRead(
  db: Db,
  input: { viewer: SongArtworkViewer; trackId: string },
): Promise<AuthorizedSongArtwork> {
  const [row] = await db
    .select({
      producerId: projects.producerId,
      clientContactId: projects.clientContactId,
      lifecycleStatus: projects.lifecycleStatus,
      artworkR2Key: projectTracks.artworkR2Key,
      artworkContentType: projectTracks.artworkContentType,
      artworkSizeBytes: projectTracks.artworkSizeBytes,
      artworkObjectEtag: projectTracks.artworkObjectEtag,
    })
    .from(projectTracks)
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .where(eq(projectTracks.id, input.trackId))
    .limit(1);
  if (
    !row ||
    !row.artworkR2Key ||
    !row.artworkContentType ||
    !row.artworkSizeBytes ||
    !row.artworkObjectEtag
  ) {
    throw new SongArtworkDomainError("NOT_FOUND", "Song artwork was not found");
  }

  if (input.viewer.role === "producer") {
    if (row.producerId !== input.viewer.producerId) {
      throw new SongArtworkDomainError("NOT_FOUND", "Song artwork was not found");
    }
  } else {
    if (row.lifecycleStatus === "waiting_for_payment") {
      throw new SongArtworkDomainError("NOT_FOUND", "Song artwork was not found");
    }
    const [contact] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, input.viewer.clerkUserId),
          eq(clientContacts.id, row.clientContactId),
          eq(clientContacts.producerId, row.producerId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .limit(1);
    if (!contact) {
      throw new SongArtworkDomainError("NOT_FOUND", "Song artwork was not found");
    }
  }

  const metadata = {
    contentType: row.artworkContentType,
    sizeBytes: row.artworkSizeBytes,
  };
  assertSongArtworkUploadMetadata(metadata);
  return {
    storageKey: row.artworkR2Key,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    objectEtag: row.artworkObjectEtag,
  };
}
