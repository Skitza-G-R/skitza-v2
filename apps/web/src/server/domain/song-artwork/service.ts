import { and, clientContacts, eq, isNull, projectTracks, projects, sql, type Db } from "@skitza/db";

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

const defaultStorage: SongArtworkStoragePort = {
  createUpload: createPrivateSongArtworkUpload,
  finalizeUpload: finalizePrivateSongArtworkUpload,
  deleteObjectQuietly: deleteSongArtworkObjectQuietly,
};

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
  db: Db,
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
    const song = await loadProducerOwnedSong(db, input);
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
    serverSecret: string;
    now?: Date | undefined;
  },
  storage: SongArtworkStoragePort = defaultStorage,
): Promise<{ artworkUrl: string }> {
  try {
    const payload = verifyOwnedSongArtworkUploadToken(
      input.serverSecret,
      input.uploadToken,
      { producerId: input.producerId, trackId: input.trackId },
      input.now,
    );
    // Ownership and the prepared base revision are checked before issuing R2
    // work, then checked again under the song lock before committing.
    const ownedInput = {
      producerId: input.producerId,
      trackId: payload.trackId,
    };
    const before = currentArtworkIdentity(await loadProducerOwnedSong(db, ownedInput));
    const { finalKey } = songArtworkObjectKeys(input.serverSecret, payload);
    if (
      before?.storageKey === finalKey &&
      before.contentType === payload.contentType &&
      before.sizeBytes === payload.sizeBytes
    ) {
      return { artworkUrl: privateSongArtworkPath(payload.trackId, payload.uploadId) };
    }
    if (songArtworkRevisionFingerprint(input.serverSecret, before) !== payload.baseRevision) {
      throw new SongArtworkDomainError(
        "CONFLICT",
        "The song cover changed. Choose the image again",
      );
    }

    const artwork: FinalizedSongArtworkObject = await storage.finalizeUpload(
      input.serverSecret,
      payload,
      input.objectEtag,
    );

    const previous = await db.transaction(async (tx) => {
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
      const current = currentArtworkIdentity(owned);
      if (
        current?.storageKey === artwork.storageKey &&
        current.contentType === artwork.contentType &&
        current.sizeBytes === artwork.sizeBytes &&
        current.objectEtag === artwork.objectEtag
      ) {
        return { storageKey: null };
      }
      if (songArtworkRevisionFingerprint(input.serverSecret, current) !== payload.baseRevision) {
        throw new SongArtworkDomainError(
          "CONFLICT",
          "The song cover changed. Choose the image again",
        );
      }
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
        storageKey: current?.storageKey ?? null,
      };
    });

    if (previous.storageKey && previous.storageKey !== artwork.storageKey) {
      await storage.deleteObjectQuietly(previous.storageKey);
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
