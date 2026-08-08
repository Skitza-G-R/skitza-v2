import { createHash } from "node:crypto";
import {
  and,
  artistHistoricalAccessGrants,
  artistNotifications,
  bookings,
  eq,
  firstVersionUploadIntents,
  inArray,
  isNotNull,
  isNull,
  notifications,
  notInArray,
  or,
  portfolioTracks,
  projectTracks,
  projects,
  purchaseDownloadOverrideEvents,
  purchases,
  songDeletionOperations,
  songPublicAccessEvents,
  songPublicLinks,
  sql,
  trackComments,
  trackVersions,
  versionApprovalEvents,
  type Db,
} from "@skitza/db";

import { lockProducerAudioStorageQuota } from "~/server/domain/audio-storage/quota";
import {
  SongDeletionError,
  type SongDeletionErrorCode,
} from "~/server/domain/song-deletion/errors";
import { selectPublicStoredVersions } from "~/server/domain/song-publication/read-model";
import {
  reconcileExactStoredAudioDeletion,
  requireHistorySafeStoredAudioIdentity,
  type ExactAudioStoragePort,
  type StoredAudioIdentity,
} from "~/server/domain/song-management/service";
import { isAudioKeyForTrackVersion } from "~/server/storage/r2";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

// A completed first-Version intent joins a hard-delete receipt only after its
// staging key has the durable write-once seal. Legacy unconditional upload
// capabilities remain blocked until an operator revokes their signing key and
// records that explicit cutover gate on the intent.

export type SongDeletionKind = "version" | "song";

export type SongDeletionManifestItem = StoredAudioIdentity &
  Readonly<{
    versionId: string;
  }>;

export type SongDeletionArtworkManifestItem = Readonly<{
  key: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  objectEtag: string;
}>;

export type SongDeletionFirstVersionStagingManifestItem = Readonly<{
  versionId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type SongDeletionFirstVersionFinalManifestItem = Readonly<{
  versionId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  completionToken: string;
}>;

export type SongDeletionPeaksManifestItem = Readonly<{
  versionId: string;
  key: string;
}>;

export type SongDeletionStoragePort = Readonly<{
  audio: ExactAudioStoragePort;
  reconcileArtworkDeletion: (item: SongDeletionArtworkManifestItem) => Promise<void>;
  reconcileFirstVersionStagingDeletion: (
    item: SongDeletionFirstVersionStagingManifestItem,
  ) => Promise<void>;
  reconcileFirstVersionFinalDeletion: (
    item: SongDeletionFirstVersionFinalManifestItem,
  ) => Promise<void>;
  reconcilePeaksDeletion: (item: SongDeletionPeaksManifestItem) => Promise<void>;
}>;

type PreparedDeletion = Readonly<{
  operationId: string;
  kind: SongDeletionKind;
  projectId: string;
  purchaseId: string;
  trackId: string;
  versionId: string | null;
  targetVersionIds: readonly string[];
  audioManifest: readonly SongDeletionManifestItem[];
  artworkManifest: readonly SongDeletionArtworkManifestItem[];
  firstVersionStagingManifest: readonly SongDeletionFirstVersionStagingManifestItem[];
  firstVersionFinalManifest: readonly SongDeletionFirstVersionFinalManifestItem[];
  peaksManifest: readonly SongDeletionPeaksManifestItem[];
  storageVerifiedAt: Date | null;
  completedAt: Date | null;
}>;

export type SongDeletionResult = Readonly<{
  kind: SongDeletionKind;
  projectId: string;
  trackId: string;
  versionId: string | null;
  alreadyCompleted: boolean;
}>;

export { SongDeletionError } from "~/server/domain/song-deletion/errors";
export type { SongDeletionErrorCode } from "~/server/domain/song-deletion/errors";

function fail(code: SongDeletionErrorCode, message: string): never {
  throw new SongDeletionError(code, message);
}

function deletionRequestDigest(
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    kind: SongDeletionKind;
    targetId: string;
  }>,
): string {
  const canonical = [
    "skitza-song-history-deletion-v1",
    input.producerId,
    input.actorClerkUserId,
    input.kind,
    input.targetId,
  ]
    .map((value) => `${Buffer.byteLength(value, "utf8").toString()}:${value}`)
    .join("|");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function readManifest(value: unknown, producerId: string): readonly SongDeletionManifestItem[] {
  if (!Array.isArray(value)) {
    fail("INTEGRITY_ERROR", "The deletion operation stored-audio manifest is invalid");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      fail("INTEGRITY_ERROR", "The deletion operation audio manifest is invalid");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.versionId !== "string" || seen.has(row.versionId)) {
      fail("INTEGRITY_ERROR", "The deletion operation audio manifest is invalid");
    }
    const identity = requireHistorySafeStoredAudioIdentity({
      key: typeof row.key === "string" ? row.key : null,
      objectEtag: typeof row.objectEtag === "string" ? row.objectEtag : null,
      sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
      fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : null,
    });
    if (
      !isAudioKeyForTrackVersion(identity.key, {
        producerId,
        trackVersionId: row.versionId,
      })
    ) {
      fail("INTEGRITY_ERROR", "The deletion manifest contains audio outside this producer");
    }
    seen.add(row.versionId);
    return { versionId: row.versionId, ...identity };
  });
}

function readTargetVersionIds(
  value: unknown,
  kind: SongDeletionKind,
  versionId: string | null,
): readonly string[] {
  if (!Array.isArray(value)) {
    fail("INTEGRITY_ERROR", "The deletion operation Version targets are invalid");
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || id.length === 0) {
      fail("INTEGRITY_ERROR", "The deletion operation Version targets are invalid");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    fail("INTEGRITY_ERROR", "The deletion operation Version targets are invalid");
  }
  if (
    (kind === "version" && (versionId === null || ids.length !== 1 || ids[0] !== versionId)) ||
    (kind === "song" && versionId !== null)
  ) {
    fail("INTEGRITY_ERROR", "The deletion operation Version targets are invalid");
  }
  return ids;
}

function readArtworkManifest(value: unknown): readonly SongDeletionArtworkManifestItem[] {
  if (!Array.isArray(value) || value.length > 1) {
    fail("INTEGRITY_ERROR", "The deletion operation artwork manifest is invalid");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      fail("INTEGRITY_ERROR", "The deletion operation artwork manifest is invalid");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.key !== "string" ||
      !row.key.startsWith("song-artwork/") ||
      (row.contentType !== "image/jpeg" &&
        row.contentType !== "image/png" &&
        row.contentType !== "image/webp") ||
      typeof row.sizeBytes !== "number" ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes <= 0 ||
      row.sizeBytes > 5 * 1024 * 1024 ||
      typeof row.objectEtag !== "string" ||
      row.objectEtag.length === 0
    ) {
      fail("INTEGRITY_ERROR", "The deletion operation artwork manifest is invalid");
    }
    return {
      key: row.key,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      objectEtag: row.objectEtag,
    };
  });
}

function readFirstVersionStagingManifest(
  value: unknown,
  producerId: string,
  targetVersionIds: readonly string[],
  kind: SongDeletionKind,
): readonly SongDeletionFirstVersionStagingManifestItem[] {
  if (!Array.isArray(value)) {
    fail("INTEGRITY_ERROR", "The deletion operation first-Version staging manifest is invalid");
  }
  const targetIds = new Set(targetVersionIds);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      fail("INTEGRITY_ERROR", "The deletion operation first-Version staging manifest is invalid");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.versionId !== "string" ||
      (kind === "version" && !targetIds.has(row.versionId)) ||
      seen.has(row.versionId) ||
      typeof row.key !== "string" ||
      !row.key.startsWith(`first-version-staging/producers/${producerId}/intents/`) ||
      typeof row.contentType !== "string" ||
      row.contentType.trim().length === 0 ||
      row.contentType.length > 120 ||
      typeof row.sizeBytes !== "number" ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes <= 0 ||
      row.sizeBytes > 524_288_000 ||
      typeof row.completionToken !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.completionToken)
    ) {
      fail("INTEGRITY_ERROR", "The deletion operation first-Version staging manifest is invalid");
    }
    seen.add(row.versionId);
    return {
      versionId: row.versionId,
      key: row.key,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      completionToken: row.completionToken,
    };
  });
}

function readFirstVersionFinalManifest(
  value: unknown,
  producerId: string,
  targetVersionIds: readonly string[],
  kind: SongDeletionKind,
): readonly SongDeletionFirstVersionFinalManifestItem[] {
  if (!Array.isArray(value)) {
    fail("INTEGRITY_ERROR", "The deletion operation first-Version final manifest is invalid");
  }
  const targetIds = new Set(targetVersionIds);
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      fail("INTEGRITY_ERROR", "The deletion operation first-Version final manifest is invalid");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.versionId !== "string" ||
      (kind === "version" && !targetIds.has(row.versionId)) ||
      seen.has(row.versionId) ||
      typeof row.key !== "string" ||
      !isAudioKeyForTrackVersion(row.key, {
        producerId,
        trackVersionId: row.versionId,
      }) ||
      typeof row.contentType !== "string" ||
      row.contentType.trim().length === 0 ||
      row.contentType.length > 120 ||
      typeof row.sizeBytes !== "number" ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes <= 0 ||
      row.sizeBytes > 524_288_000 ||
      typeof row.completionToken !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.completionToken)
    ) {
      fail("INTEGRITY_ERROR", "The deletion operation first-Version final manifest is invalid");
    }
    seen.add(row.versionId);
    return {
      versionId: row.versionId,
      key: row.key,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      completionToken: row.completionToken,
    };
  });
}

function readPeaksManifest(
  value: unknown,
  targetVersionIds: readonly string[],
): readonly SongDeletionPeaksManifestItem[] {
  if (!Array.isArray(value)) {
    fail("INTEGRITY_ERROR", "The deletion operation waveform manifest is invalid");
  }
  const targets = new Set(targetVersionIds);
  const seenEntries = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      fail("INTEGRITY_ERROR", "The deletion operation waveform manifest is invalid");
    }
    const row = entry as Record<string, unknown>;
    const entryIdentity =
      typeof row.versionId === "string" && typeof row.key === "string"
        ? `${row.versionId}\0${row.key}`
        : "";
    if (
      typeof row.versionId !== "string" ||
      !targets.has(row.versionId) ||
      typeof row.key !== "string" ||
      !row.key.startsWith("peaks/") ||
      row.key.length > 1024 ||
      seenEntries.has(entryIdentity)
    ) {
      fail("INTEGRITY_ERROR", "The deletion operation waveform manifest is invalid");
    }
    seenEntries.add(entryIdentity);
    return { versionId: row.versionId, key: row.key };
  });
}

function preparedFromRow(
  row: typeof songDeletionOperations.$inferSelect,
  expectedDigest: string,
): PreparedDeletion {
  if (row.requestDigest !== expectedDigest) {
    fail("CONFLICT", "This deletion request key is already used for another action");
  }
  const audioManifest = readManifest(row.audioManifest, row.producerId);
  const targetVersionIds = readTargetVersionIds(row.targetVersionIds, row.kind, row.versionId);
  const artworkManifest = readArtworkManifest(row.artworkManifest);
  const targetVersionSet = new Set(targetVersionIds);
  if (audioManifest.some((item) => !targetVersionSet.has(item.versionId))) {
    fail("INTEGRITY_ERROR", "The deletion operation audio manifest is outside its targets");
  }
  if (row.kind === "version" && artworkManifest.length > 0) {
    fail("INTEGRITY_ERROR", "A Version deletion cannot remove Song artwork");
  }
  const firstVersionStagingManifest = readFirstVersionStagingManifest(
    row.firstVersionStagingManifest,
    row.producerId,
    targetVersionIds,
    row.kind,
  );
  const firstVersionFinalManifest = readFirstVersionFinalManifest(
    row.firstVersionFinalManifest,
    row.producerId,
    targetVersionIds,
    row.kind,
  );
  const versionAudioKeys = new Set(audioManifest.map((item) => item.key));
  if (firstVersionFinalManifest.some((item) => versionAudioKeys.has(item.key))) {
    fail("INTEGRITY_ERROR", "The deletion operation contains duplicate final audio ownership");
  }
  const peaksManifest = readPeaksManifest(row.peaksManifest, targetVersionIds);
  const manifestBytes = [...audioManifest, ...firstVersionFinalManifest].reduce(
    (total, item) => total + item.sizeBytes,
    0,
  );
  if (manifestBytes !== row.audioBytes) {
    fail("INTEGRITY_ERROR", "The deletion operation audio total is invalid");
  }
  return {
    operationId: row.id,
    kind: row.kind,
    projectId: row.projectId,
    purchaseId: row.purchaseId,
    trackId: row.trackId,
    versionId: row.versionId,
    targetVersionIds,
    audioManifest,
    artworkManifest,
    firstVersionStagingManifest,
    firstVersionFinalManifest,
    peaksManifest,
    storageVerifiedAt: row.storageVerifiedAt,
    completedAt: row.completedAt,
  };
}

function versionHasPendingUpload(version: {
  pendingAudioR2Key: string | null;
  pendingAudioUploadId: string | null;
  pendingAudioInitiationDigest: string | null;
  pendingAudioCompletionToken: string | null;
  pendingAudioSizeBytes: number | null;
  pendingAudioStartedAt: Date | null;
  pendingAudioCreateAttemptedAt: Date | null;
  pendingAudioCompleteAttemptedAt: Date | null;
  pendingAudioPartUrlsExpireAt: Date | null;
  pendingAudioCancelRequestedAt: Date | null;
  pendingAudioCleanupEtag: string | null;
}): boolean {
  return (
    version.pendingAudioR2Key !== null ||
    version.pendingAudioUploadId !== null ||
    version.pendingAudioInitiationDigest !== null ||
    version.pendingAudioCompletionToken !== null ||
    version.pendingAudioSizeBytes !== null ||
    version.pendingAudioStartedAt !== null ||
    version.pendingAudioCreateAttemptedAt !== null ||
    version.pendingAudioCompleteAttemptedAt !== null ||
    version.pendingAudioPartUrlsExpireAt !== null ||
    version.pendingAudioCancelRequestedAt !== null ||
    version.pendingAudioCleanupEtag !== null
  );
}

async function existingOperation(
  tx: TransactionDb,
  input: Readonly<{ producerId: string; operationKey: string; requestDigest: string }>,
): Promise<PreparedDeletion | null> {
  const [row] = await tx
    .select()
    .from(songDeletionOperations)
    .where(
      and(
        eq(songDeletionOperations.producerId, input.producerId),
        eq(songDeletionOperations.operationKey, input.operationKey),
      ),
    )
    .limit(1)
    .for("update");
  return row ? preparedFromRow(row, input.requestDigest) : null;
}

async function lockProjectAndPurchase(
  tx: TransactionDb,
  input: Readonly<{ projectId: string; purchaseId: string }>,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.purchaseId}, 0))`);
}

async function assertNoOtherPendingDeletion(
  tx: TransactionDb,
  input: Readonly<{ producerId: string; trackId: string }>,
): Promise<void> {
  const [pending] = await tx
    .select({ id: songDeletionOperations.id })
    .from(songDeletionOperations)
    .where(
      and(
        eq(songDeletionOperations.producerId, input.producerId),
        eq(songDeletionOperations.trackId, input.trackId),
        isNull(songDeletionOperations.completedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (pending) {
    fail("CONFLICT", "Finish the current deletion for this Song before starting another one");
  }
}

const versionProjection = {
  id: trackVersions.id,
  trackId: trackVersions.trackId,
  purchaseId: trackVersions.purchaseId,
  producerId: trackVersions.producerId,
  label: trackVersions.label,
  audioUrl: trackVersions.audioUrl,
  durationMs: trackVersions.durationMs,
  audioR2Key: trackVersions.audioR2Key,
  sizeBytes: trackVersions.sizeBytes,
  audioObjectEtag: trackVersions.audioObjectEtag,
  audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
  peaksR2Key: trackVersions.peaksR2Key,
  peaks: trackVersions.peaks,
  uploadedAt: trackVersions.uploadedAt,
  audioDeletedAt: trackVersions.audioDeletedAt,
  audioStorageDeletedAt: trackVersions.audioStorageDeletedAt,
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
} as const;

function manifestItem(
  producerId: string,
  version: {
    id: string;
    audioR2Key: string | null;
    sizeBytes: number | null;
    audioObjectEtag: string | null;
    audioIdentityFingerprint: string | null;
  },
): SongDeletionManifestItem {
  const identity = requireHistorySafeStoredAudioIdentity({
    key: version.audioR2Key,
    objectEtag: version.audioObjectEtag,
    sizeBytes: version.sizeBytes,
    fingerprint: version.audioIdentityFingerprint,
  });
  if (
    !isAudioKeyForTrackVersion(identity.key, {
      producerId,
      trackVersionId: version.id,
    })
  ) {
    fail("INTEGRITY_ERROR", "The stored audio does not belong to this producer Version");
  }
  return { versionId: version.id, ...identity };
}

function optionalManifestItem(
  producerId: string,
  version: {
    id: string;
    audioR2Key: string | null;
    sizeBytes: number | null;
    audioObjectEtag: string | null;
    audioIdentityFingerprint: string | null;
  },
): SongDeletionManifestItem | null {
  const identity = [
    version.audioR2Key,
    version.sizeBytes,
    version.audioObjectEtag,
    version.audioIdentityFingerprint,
  ];
  if (identity.every((value) => value === null)) return null;
  if (identity.some((value) => value === null)) {
    fail("INTEGRITY_ERROR", "The Version has incomplete stored-audio identity");
  }
  return manifestItem(producerId, version);
}

function artworkManifestItem(track: {
  artworkR2Key: string | null;
  artworkContentType: string | null;
  artworkSizeBytes: number | null;
  artworkObjectEtag: string | null;
}): SongDeletionArtworkManifestItem | null {
  const identity = [
    track.artworkR2Key,
    track.artworkContentType,
    track.artworkSizeBytes,
    track.artworkObjectEtag,
  ];
  if (identity.every((value) => value === null)) return null;
  if (
    !track.artworkR2Key ||
    !track.artworkR2Key.startsWith("song-artwork/") ||
    (track.artworkContentType !== "image/jpeg" &&
      track.artworkContentType !== "image/png" &&
      track.artworkContentType !== "image/webp") ||
    track.artworkSizeBytes === null ||
    !Number.isSafeInteger(track.artworkSizeBytes) ||
    track.artworkSizeBytes <= 0 ||
    track.artworkSizeBytes > 5 * 1024 * 1024 ||
    !track.artworkObjectEtag
  ) {
    fail("INTEGRITY_ERROR", "The Song has incomplete artwork identity");
  }
  return {
    key: track.artworkR2Key,
    contentType: track.artworkContentType,
    sizeBytes: track.artworkSizeBytes,
    objectEtag: track.artworkObjectEtag,
  };
}

type MatchedPortfolioTrack = Readonly<{
  id: string;
  versionId: string;
  audioR2Key: string | null;
  audioUrl: string | null;
  peaksR2Key: string | null;
}>;

async function loadMatchingPortfolioTracks(
  tx: TransactionDb,
  input: Readonly<{
    producerId: string;
    targetVersions: readonly Readonly<{
      id: string;
      audioR2Key: string | null;
      audioUrl: string | null;
    }>[];
  }>,
): Promise<MatchedPortfolioTrack[]> {
  const targetByAudioKey = new Map<string, string>();
  const targetByAudioUrl = new Map<string, string>();
  for (const version of input.targetVersions) {
    for (const [identity, index] of [
      [version.audioR2Key, targetByAudioKey],
      [version.audioUrl, targetByAudioUrl],
    ] as const) {
      if (identity === null) continue;
      const previous = index.get(identity);
      if (previous !== undefined && previous !== version.id) {
        fail("INTEGRITY_ERROR", "The deleted Versions share a portfolio audio identity");
      }
      index.set(identity, version.id);
    }
  }
  const predicates = [
    ...(targetByAudioKey.size > 0
      ? [inArray(portfolioTracks.audioR2Key, [...targetByAudioKey.keys()])]
      : []),
    ...(targetByAudioUrl.size > 0
      ? [inArray(portfolioTracks.audioUrl, [...targetByAudioUrl.keys()])]
      : []),
  ];
  if (predicates.length === 0) return [];

  const rows = await tx
    .select({
      id: portfolioTracks.id,
      audioR2Key: portfolioTracks.audioR2Key,
      audioUrl: portfolioTracks.audioUrl,
      peaksR2Key: portfolioTracks.peaksR2Key,
    })
    .from(portfolioTracks)
    .where(and(eq(portfolioTracks.producerId, input.producerId), or(...predicates)))
    .for("update");

  return rows.map((row) => {
    const keyVersionId = row.audioR2Key === null ? undefined : targetByAudioKey.get(row.audioR2Key);
    const urlVersionId = row.audioUrl === null ? undefined : targetByAudioUrl.get(row.audioUrl);
    const versionId = keyVersionId ?? urlVersionId;
    if (
      (keyVersionId !== undefined && urlVersionId !== undefined && keyVersionId !== urlVersionId) ||
      versionId === undefined
    ) {
      fail("INTEGRITY_ERROR", "A portfolio item cannot be matched safely to one deleted Version");
    }
    return {
      ...row,
      versionId,
    };
  });
}

function peaksManifestItems(
  versions: readonly Readonly<{ id: string; peaksR2Key: string | null }>[],
  portfolioTracks: readonly MatchedPortfolioTrack[],
): SongDeletionPeaksManifestItem[] {
  const manifest: SongDeletionPeaksManifestItem[] = [];
  const seenEntries = new Set<string>();
  const append = (versionId: string, key: string | null, owner: "Version" | "portfolio") => {
    if (key === null) return;
    if (!key.startsWith("peaks/") || key.length > 1024) {
      fail("INTEGRITY_ERROR", `The ${owner} item has an invalid legacy waveform key`);
    }
    const identity = `${versionId}\0${key}`;
    if (seenEntries.has(identity)) return;
    seenEntries.add(identity);
    manifest.push({ versionId, key });
  };
  for (const version of versions) append(version.id, version.peaksR2Key, "Version");
  for (const track of portfolioTracks) append(track.versionId, track.peaksR2Key, "portfolio");
  return manifest.sort(
    (left, right) =>
      left.versionId.localeCompare(right.versionId) || left.key.localeCompare(right.key),
  );
}

async function assertPeaksManifestExclusive(
  tx: TransactionDb,
  input: Readonly<{
    producerId: string;
    targetVersions: readonly Readonly<{
      id: string;
      audioR2Key: string | null;
      audioUrl: string | null;
    }>[];
    peaksManifest: readonly SongDeletionPeaksManifestItem[];
  }>,
): Promise<void> {
  const targetIds = input.targetVersions.map((version) => version.id);
  const keys = [...new Set(input.peaksManifest.map((item) => item.key))];
  if (input.peaksManifest.length === 0) return;
  const sharedVersions = await tx
    .select({ id: trackVersions.id })
    .from(trackVersions)
    .where(and(inArray(trackVersions.peaksR2Key, keys), notInArray(trackVersions.id, targetIds)))
    .limit(1);
  if (sharedVersions.length > 0) {
    fail("INTEGRITY_ERROR", "A legacy waveform key is shared with another Version");
  }

  const targetAudioKeys = new Set(
    input.targetVersions.flatMap((version) =>
      version.audioR2Key === null ? [] : [version.audioR2Key],
    ),
  );
  const targetAudioUrls = new Set(
    input.targetVersions.flatMap((version) =>
      version.audioUrl === null ? [] : [version.audioUrl],
    ),
  );
  const portfolioReferences = await tx
    .select({
      producerId: portfolioTracks.producerId,
      audioR2Key: portfolioTracks.audioR2Key,
      audioUrl: portfolioTracks.audioUrl,
    })
    .from(portfolioTracks)
    .where(inArray(portfolioTracks.peaksR2Key, keys));
  if (
    portfolioReferences.some(
      (reference) =>
        reference.producerId !== input.producerId ||
        !(
          (reference.audioR2Key !== null && targetAudioKeys.has(reference.audioR2Key)) ||
          (reference.audioUrl !== null && targetAudioUrls.has(reference.audioUrl))
        ),
    )
  ) {
    fail("INTEGRITY_ERROR", "A legacy waveform key is shared with another portfolio item");
  }
}

async function loadFirstVersionManifests(
  tx: TransactionDb,
  input: Readonly<{
    producerId: string;
    trackId: string;
    versionIds: readonly string[] | null;
    audioManifest: readonly SongDeletionManifestItem[];
  }>,
): Promise<
  Readonly<{
    staging: SongDeletionFirstVersionStagingManifestItem[];
    final: SongDeletionFirstVersionFinalManifestItem[];
  }>
> {
  if (input.versionIds !== null && input.versionIds.length === 0) {
    return { staging: [], final: [] };
  }
  const intents = await tx
    .select({
      versionId: firstVersionUploadIntents.versionId,
      stagingKey: firstVersionUploadIntents.stagingAudioR2Key,
      finalKey: firstVersionUploadIntents.audioR2Key,
      contentType: firstVersionUploadIntents.audioContentType,
      sizeBytes: firstVersionUploadIntents.audioSizeBytes,
      completionToken: firstVersionUploadIntents.completionToken,
      cleanupSafe: sql<boolean>`${firstVersionUploadIntents.stagingSealedAt} IS NOT NULL`,
    })
    .from(firstVersionUploadIntents)
    .where(
      and(
        eq(firstVersionUploadIntents.producerId, input.producerId),
        eq(firstVersionUploadIntents.trackId, input.trackId),
        ...(input.versionIds === null
          ? []
          : [inArray(firstVersionUploadIntents.versionId, [...input.versionIds])]),
        isNotNull(firstVersionUploadIntents.completedAt),
      ),
    )
    .for("update");
  if (intents.some((intent) => !intent.cleanupSafe)) {
    fail(
      "CONFLICT",
      "This first upload is still finishing. Please try deleting it again in a few minutes.",
    );
  }
  const versionAudioByKey = new Map(
    input.audioManifest.map((item) => [item.key, item.versionId] as const),
  );
  const staging = intents.map((intent) => ({
    versionId: intent.versionId,
    key: intent.stagingKey,
    contentType: intent.contentType,
    sizeBytes: intent.sizeBytes,
    completionToken: intent.completionToken,
  }));
  const final = intents.flatMap((intent) => {
    const versionOwner = versionAudioByKey.get(intent.finalKey);
    if (versionOwner !== undefined) {
      if (versionOwner !== intent.versionId) {
        fail("INTEGRITY_ERROR", "The first-Version final audio has conflicting ownership");
      }
      return [];
    }
    return [
      {
        versionId: intent.versionId,
        key: intent.finalKey,
        contentType: intent.contentType,
        sizeBytes: intent.sizeBytes,
        completionToken: intent.completionToken,
      },
    ];
  });
  return { staging, final };
}

async function prepareVersionDeletion(
  db: Db,
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    versionId: string;
  }>,
): Promise<PreparedDeletion> {
  const requestDigest = deletionRequestDigest({
    producerId: input.producerId,
    actorClerkUserId: input.actorClerkUserId,
    kind: "version",
    targetId: input.versionId,
  });
  return db.transaction(async (tx) => {
    await lockProducerAudioStorageQuota(tx, input.producerId);
    const previous = await existingOperation(tx, {
      producerId: input.producerId,
      operationKey: input.operationKey,
      requestDigest,
    });
    if (previous) return previous;

    const [scope] = await tx
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
    if (!scope) fail("NOT_FOUND", "The Version was not found");
    await lockProjectAndPurchase(tx, scope);
    await assertNoOtherPendingDeletion(tx, {
      producerId: input.producerId,
      trackId: scope.trackId,
    });

    const [track] = await tx
      .select({
        id: projectTracks.id,
        portfolioPublishedAt: projectTracks.portfolioPublishedAt,
      })
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .limit(1)
      .for("update");
    if (!track) fail("NOT_FOUND", "The Song was not found");
    const versions = await tx
      .select(versionProjection)
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.purchaseId, scope.purchaseId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .for("update");
    if (versions.length <= 1) {
      fail("DELETE_SONG_REQUIRED", "This is the only Version. Delete the Song instead.");
    }
    const target = versions.find((version) => version.id === input.versionId);
    if (!target) fail("NOT_FOUND", "The Version was not found");
    if (versions.some(versionHasPendingUpload)) {
      fail("CONFLICT", "Stop active uploads on this Song before deleting a Version");
    }
    const publicStoredVersions = selectPublicStoredVersions(versions, {
      producerId: input.producerId,
      purchaseId: scope.purchaseId,
      trackId: scope.trackId,
    });
    const publishedPortfolioVersion = publicStoredVersions[0];
    const removesPublishedPortfolioAudio =
      track.portfolioPublishedAt !== null && publishedPortfolioVersion?.id === target.id;
    const remainingPublicStoredVersionCount = publicStoredVersions.filter(
      (version) => version.id !== target.id,
    ).length;
    const removesLastPublicStoredAudio =
      publicStoredVersions.some((version) => version.id === target.id) &&
      remainingPublicStoredVersionCount === 0;
    const targetAudio = optionalManifestItem(input.producerId, target);
    const audioManifest = targetAudio ? [targetAudio] : [];
    const matchingPortfolioTracks = await loadMatchingPortfolioTracks(tx, {
      producerId: input.producerId,
      targetVersions: [target],
    });
    const peaksManifest = peaksManifestItems([target], matchingPortfolioTracks);
    await assertPeaksManifestExclusive(tx, {
      producerId: input.producerId,
      targetVersions: [target],
      peaksManifest,
    });
    const firstVersionManifests = await loadFirstVersionManifests(tx, {
      producerId: input.producerId,
      trackId: scope.trackId,
      versionIds: [input.versionId],
      audioManifest,
    });
    const preparedAt = sql<Date>`now()`;
    if (target.audioDeletedAt === null) {
      await tx
        .update(trackVersions)
        .set({ audioDeletedAt: preparedAt })
        .where(
          and(
            eq(trackVersions.id, input.versionId),
            eq(trackVersions.producerId, input.producerId),
          ),
        );
    }
    if (matchingPortfolioTracks.length > 0) {
      await tx.delete(portfolioTracks).where(
        and(
          eq(portfolioTracks.producerId, input.producerId),
          inArray(
            portfolioTracks.id,
            matchingPortfolioTracks.map((track) => track.id),
          ),
        ),
      );
    }
    if (removesPublishedPortfolioAudio) {
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
    }
    if (removesLastPublicStoredAudio) {
      await tx
        .update(songPublicLinks)
        .set({ disabledAt: preparedAt, updatedAt: preparedAt })
        .where(
          and(
            eq(songPublicLinks.trackId, scope.trackId),
            eq(songPublicLinks.purchaseId, scope.purchaseId),
            eq(songPublicLinks.producerId, input.producerId),
            isNull(songPublicLinks.disabledAt),
          ),
        );
    }
    await tx
      .update(projects)
      .set({ updatedAt: preparedAt })
      .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, input.producerId)));
    const [created] = await tx
      .insert(songDeletionOperations)
      .values({
        producerId: input.producerId,
        operationKey: input.operationKey,
        requestDigest,
        kind: "version",
        projectId: scope.projectId,
        purchaseId: scope.purchaseId,
        trackId: scope.trackId,
        versionId: input.versionId,
        targetVersionIds: [input.versionId],
        actorClerkUserId: input.actorClerkUserId,
        audioManifest,
        artworkManifest: [],
        firstVersionStagingManifest: firstVersionManifests.staging,
        firstVersionFinalManifest: firstVersionManifests.final,
        peaksManifest,
        audioBytes:
          (targetAudio?.sizeBytes ?? 0) +
          firstVersionManifests.final.reduce((total, item) => total + item.sizeBytes, 0),
        preparedAt,
      })
      .returning();
    if (!created) fail("INTEGRITY_ERROR", "The Version deletion could not be prepared");
    return preparedFromRow(created, requestDigest);
  });
}

async function prepareSongDeletion(
  db: Db,
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    trackId: string;
  }>,
): Promise<PreparedDeletion> {
  const requestDigest = deletionRequestDigest({
    producerId: input.producerId,
    actorClerkUserId: input.actorClerkUserId,
    kind: "song",
    targetId: input.trackId,
  });
  return db.transaction(async (tx) => {
    await lockProducerAudioStorageQuota(tx, input.producerId);
    const previous = await existingOperation(tx, {
      producerId: input.producerId,
      operationKey: input.operationKey,
      requestDigest,
    });
    if (previous) return previous;

    const [scope] = await tx
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
    if (!scope) fail("NOT_FOUND", "The Song was not found");
    await lockProjectAndPurchase(tx, scope);
    await assertNoOtherPendingDeletion(tx, {
      producerId: input.producerId,
      trackId: scope.trackId,
    });
    const [track] = await tx
      .select({
        id: projectTracks.id,
        artworkR2Key: projectTracks.artworkR2Key,
        artworkContentType: projectTracks.artworkContentType,
        artworkSizeBytes: projectTracks.artworkSizeBytes,
        artworkObjectEtag: projectTracks.artworkObjectEtag,
      })
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .limit(1)
      .for("update");
    if (!track) fail("NOT_FOUND", "The Song was not found");
    const versions = await tx
      .select(versionProjection)
      .from(trackVersions)
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.purchaseId, scope.purchaseId),
          eq(trackVersions.producerId, input.producerId),
        ),
      )
      .for("update");
    if (versions.some(versionHasPendingUpload)) {
      fail("CONFLICT", "Stop active uploads before deleting this Song");
    }
    const audioManifest = versions
      .map((version) => optionalManifestItem(input.producerId, version))
      .filter((item): item is SongDeletionManifestItem => item !== null);
    const matchingPortfolioTracks = await loadMatchingPortfolioTracks(tx, {
      producerId: input.producerId,
      targetVersions: versions,
    });
    const peaksManifest = peaksManifestItems(versions, matchingPortfolioTracks);
    await assertPeaksManifestExclusive(tx, {
      producerId: input.producerId,
      targetVersions: versions,
      peaksManifest,
    });
    const artwork = artworkManifestItem(track);
    const artworkManifest = artwork ? [artwork] : [];
    const targetVersionIds = versions.map((version) => version.id).sort();
    const firstVersionManifests = await loadFirstVersionManifests(tx, {
      producerId: input.producerId,
      trackId: scope.trackId,
      versionIds: null,
      audioManifest,
    });
    const audioBytes = [...audioManifest, ...firstVersionManifests.final].reduce(
      (total, item) => total + item.sizeBytes,
      0,
    );
    const preparedAt = sql<Date>`now()`;
    await tx
      .update(trackVersions)
      .set({ audioDeletedAt: preparedAt })
      .where(
        and(
          eq(trackVersions.trackId, scope.trackId),
          eq(trackVersions.purchaseId, scope.purchaseId),
          eq(trackVersions.producerId, input.producerId),
          isNull(trackVersions.audioDeletedAt),
        ),
      );
    if (matchingPortfolioTracks.length > 0) {
      await tx.delete(portfolioTracks).where(
        and(
          eq(portfolioTracks.producerId, input.producerId),
          inArray(
            portfolioTracks.id,
            matchingPortfolioTracks.map((track) => track.id),
          ),
        ),
      );
    }
    await tx
      .update(projectTracks)
      .set({
        portfolioPublishedAt: null,
        archivedAt: sql`coalesce(${projectTracks.archivedAt}, ${preparedAt})`,
      })
      .where(eq(projectTracks.id, scope.trackId));
    await tx
      .update(songPublicLinks)
      .set({ disabledAt: preparedAt, updatedAt: preparedAt })
      .where(
        and(
          eq(songPublicLinks.trackId, scope.trackId),
          eq(songPublicLinks.purchaseId, scope.purchaseId),
          eq(songPublicLinks.producerId, input.producerId),
        ),
      );
    await tx
      .update(projects)
      .set({ updatedAt: preparedAt })
      .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, input.producerId)));
    const [created] = await tx
      .insert(songDeletionOperations)
      .values({
        producerId: input.producerId,
        operationKey: input.operationKey,
        requestDigest,
        kind: "song",
        projectId: scope.projectId,
        purchaseId: scope.purchaseId,
        trackId: scope.trackId,
        versionId: null,
        targetVersionIds,
        actorClerkUserId: input.actorClerkUserId,
        audioManifest,
        artworkManifest,
        firstVersionStagingManifest: firstVersionManifests.staging,
        firstVersionFinalManifest: firstVersionManifests.final,
        peaksManifest,
        audioBytes,
        preparedAt,
      })
      .returning();
    if (!created) fail("INTEGRITY_ERROR", "The Song deletion could not be prepared");
    return preparedFromRow(created, requestDigest);
  });
}

async function verifyStorageDeletion(
  db: Db,
  storage: SongDeletionStoragePort,
  operation: PreparedDeletion,
  producerId: string,
): Promise<PreparedDeletion> {
  if (operation.completedAt || operation.storageVerifiedAt) return operation;
  for (const item of operation.audioManifest) {
    await reconcileExactStoredAudioDeletion(storage.audio, item);
  }
  for (const item of operation.artworkManifest) {
    await storage.reconcileArtworkDeletion(item);
  }
  for (const item of operation.firstVersionFinalManifest) {
    await storage.reconcileFirstVersionFinalDeletion(item);
  }
  for (const item of operation.firstVersionStagingManifest) {
    await storage.reconcileFirstVersionStagingDeletion(item);
  }
  for (const item of operation.peaksManifest) {
    await storage.reconcilePeaksDeletion(item);
  }
  return db.transaction(async (tx) => {
    await lockProducerAudioStorageQuota(tx, producerId);
    const [locked] = await tx
      .select()
      .from(songDeletionOperations)
      .where(
        and(
          eq(songDeletionOperations.id, operation.operationId),
          eq(songDeletionOperations.producerId, producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!locked) fail("INTEGRITY_ERROR", "The deletion operation was not found");
    const verified = preparedFromRow(locked, locked.requestDigest);
    if (verified.completedAt || verified.storageVerifiedAt) return verified;
    const [updated] = await tx
      .update(songDeletionOperations)
      .set({ storageVerifiedAt: sql`now()` })
      .where(eq(songDeletionOperations.id, operation.operationId))
      .returning();
    if (!updated) fail("INTEGRITY_ERROR", "The storage deletion could not be recorded");
    return preparedFromRow(updated, updated.requestDigest);
  });
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = [...left].sort();
  const actual = [...right].sort();
  return expected.every((value, index) => value === actual[index]);
}

function sameStoredAudioIdentity(
  left: SongDeletionManifestItem,
  right: SongDeletionManifestItem,
): boolean {
  return (
    left.versionId === right.versionId &&
    left.key === right.key &&
    left.objectEtag === right.objectEtag &&
    left.sizeBytes === right.sizeBytes &&
    left.fingerprint === right.fingerprint
  );
}

function sameArtworkIdentity(
  left: SongDeletionArtworkManifestItem,
  right: SongDeletionArtworkManifestItem,
): boolean {
  return (
    left.key === right.key &&
    left.contentType === right.contentType &&
    left.sizeBytes === right.sizeBytes &&
    left.objectEtag === right.objectEtag
  );
}

function sameFirstVersionStagingIdentity(
  left: SongDeletionFirstVersionStagingManifestItem,
  right: SongDeletionFirstVersionStagingManifestItem,
): boolean {
  return (
    left.versionId === right.versionId &&
    left.key === right.key &&
    left.contentType === right.contentType &&
    left.sizeBytes === right.sizeBytes &&
    left.completionToken === right.completionToken
  );
}

function sameFirstVersionFinalIdentity(
  left: SongDeletionFirstVersionFinalManifestItem,
  right: SongDeletionFirstVersionFinalManifestItem,
): boolean {
  return (
    left.versionId === right.versionId &&
    left.key === right.key &&
    left.contentType === right.contentType &&
    left.sizeBytes === right.sizeBytes &&
    left.completionToken === right.completionToken
  );
}

async function assertPreparedTargetsUnchanged(
  tx: TransactionDb,
  operation: PreparedDeletion,
  producerId: string,
): Promise<void> {
  const [track] = await tx
    .select({
      id: projectTracks.id,
      artworkR2Key: projectTracks.artworkR2Key,
      artworkContentType: projectTracks.artworkContentType,
      artworkSizeBytes: projectTracks.artworkSizeBytes,
      artworkObjectEtag: projectTracks.artworkObjectEtag,
    })
    .from(projectTracks)
    .where(
      and(
        eq(projectTracks.id, operation.trackId),
        eq(projectTracks.projectId, operation.projectId),
        eq(projectTracks.purchaseId, operation.purchaseId),
      ),
    )
    .limit(1)
    .for("update");
  if (!track) fail("INTEGRITY_ERROR", "The prepared Song target no longer exists");

  const rows = await tx
    .select(versionProjection)
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.trackId, operation.trackId),
        eq(trackVersions.purchaseId, operation.purchaseId),
        eq(trackVersions.producerId, producerId),
        ...(operation.kind === "version" && operation.versionId
          ? [eq(trackVersions.id, operation.versionId)]
          : []),
      ),
    )
    .for("update");
  if (
    !sameStringSet(
      operation.targetVersionIds,
      rows.map((row) => row.id),
    )
  ) {
    fail("CONFLICT", "The Song changed while deletion was in progress. Try again.");
  }

  const manifestByVersion = new Map(
    operation.audioManifest.map((item) => [item.versionId, item] as const),
  );
  for (const row of rows) {
    if (row.audioDeletedAt === null || versionHasPendingUpload(row)) {
      fail("CONFLICT", "The Version changed while deletion was in progress. Try again.");
    }
    const currentIdentity = optionalManifestItem(producerId, row);
    const preparedIdentity = manifestByVersion.get(row.id) ?? null;
    if (
      (currentIdentity === null) !== (preparedIdentity === null) ||
      (currentIdentity &&
        preparedIdentity &&
        !sameStoredAudioIdentity(currentIdentity, preparedIdentity))
    ) {
      fail("INTEGRITY_ERROR", "The Version audio identity changed during deletion");
    }
  }

  const preparedPeaksByVersion = new Map<string, Set<string>>();
  for (const item of operation.peaksManifest) {
    const keys = preparedPeaksByVersion.get(item.versionId) ?? new Set<string>();
    keys.add(item.key);
    preparedPeaksByVersion.set(item.versionId, keys);
  }
  for (const row of rows) {
    if (
      row.peaksR2Key !== null &&
      !(preparedPeaksByVersion.get(row.id)?.has(row.peaksR2Key) ?? false)
    ) {
      fail("INTEGRITY_ERROR", "The legacy waveform identity changed during deletion");
    }
  }

  const currentFirstVersion = await loadFirstVersionManifests(tx, {
    producerId,
    trackId: operation.trackId,
    versionIds: operation.kind === "song" ? null : operation.targetVersionIds,
    audioManifest: operation.audioManifest,
  });
  const preparedStagingByVersion = new Map(
    operation.firstVersionStagingManifest.map((item) => [item.versionId, item] as const),
  );
  if (
    currentFirstVersion.staging.length !== operation.firstVersionStagingManifest.length ||
    currentFirstVersion.staging.some((item) => {
      const prepared = preparedStagingByVersion.get(item.versionId);
      return !prepared || !sameFirstVersionStagingIdentity(item, prepared);
    })
  ) {
    fail("INTEGRITY_ERROR", "The first-Version staging identity changed during deletion");
  }
  const preparedFinalByVersion = new Map(
    operation.firstVersionFinalManifest.map((item) => [item.versionId, item] as const),
  );
  if (
    currentFirstVersion.final.length !== operation.firstVersionFinalManifest.length ||
    currentFirstVersion.final.some((item) => {
      const prepared = preparedFinalByVersion.get(item.versionId);
      return !prepared || !sameFirstVersionFinalIdentity(item, prepared);
    })
  ) {
    fail("INTEGRITY_ERROR", "The first-Version final identity changed during deletion");
  }

  if (operation.kind === "song") {
    const currentArtwork = artworkManifestItem(track);
    const preparedArtwork = operation.artworkManifest[0] ?? null;
    if (
      (currentArtwork === null) !== (preparedArtwork === null) ||
      (currentArtwork && preparedArtwork && !sameArtworkIdentity(currentArtwork, preparedArtwork))
    ) {
      fail("CONFLICT", "The Song artwork changed while deletion was in progress. Try again.");
    }
  }
}

async function deleteVersionHistory(
  tx: TransactionDb,
  input: Readonly<{ producerId: string; versionId: string; trackId: string }>,
): Promise<void> {
  const comments = await tx
    .select({ id: trackComments.id })
    .from(trackComments)
    .where(
      and(
        eq(trackComments.versionId, input.versionId),
        eq(trackComments.producerId, input.producerId),
      ),
    );
  const commentIds = comments.map((comment) => comment.id);
  await tx
    .delete(notifications)
    .where(
      and(
        eq(notifications.producerId, input.producerId),
        or(
          eq(notifications.trackVersionId, input.versionId),
          ...(commentIds.length > 0 ? [inArray(notifications.commentId, commentIds)] : []),
        ),
      ),
    );
  await tx
    .delete(artistNotifications)
    .where(
      and(
        eq(artistNotifications.producerId, input.producerId),
        eq(artistNotifications.subjectType, "track_version"),
        eq(artistNotifications.subjectId, input.versionId),
      ),
    );
  await tx
    .delete(artistHistoricalAccessGrants)
    .where(
      and(
        eq(artistHistoricalAccessGrants.producerId, input.producerId),
        or(
          and(
            inArray(artistHistoricalAccessGrants.resourceType, [
              "track_version",
              "track_version_download",
            ]),
            eq(artistHistoricalAccessGrants.resourceId, input.versionId),
          ),
          ...(commentIds.length > 0
            ? [
                and(
                  eq(artistHistoricalAccessGrants.resourceType, "track_comment"),
                  inArray(artistHistoricalAccessGrants.resourceId, commentIds),
                ),
              ]
            : []),
        ),
      ),
    );
  await tx
    .delete(songPublicAccessEvents)
    .where(
      and(
        eq(songPublicAccessEvents.producerId, input.producerId),
        eq(songPublicAccessEvents.trackId, input.trackId),
        eq(songPublicAccessEvents.versionId, input.versionId),
      ),
    );
  if (commentIds.length > 0) {
    await tx.delete(trackComments).where(inArray(trackComments.id, commentIds));
  }
  await tx
    .delete(versionApprovalEvents)
    .where(
      and(
        eq(versionApprovalEvents.producerId, input.producerId),
        eq(versionApprovalEvents.versionId, input.versionId),
      ),
    );
  await tx
    .delete(purchaseDownloadOverrideEvents)
    .where(
      and(
        eq(purchaseDownloadOverrideEvents.producerId, input.producerId),
        eq(purchaseDownloadOverrideEvents.versionId, input.versionId),
      ),
    );
  await tx
    .delete(firstVersionUploadIntents)
    .where(
      and(
        eq(firstVersionUploadIntents.producerId, input.producerId),
        eq(firstVersionUploadIntents.trackId, input.trackId),
        eq(firstVersionUploadIntents.versionId, input.versionId),
        isNotNull(firstVersionUploadIntents.completedAt),
      ),
    );
  await tx
    .delete(trackVersions)
    .where(
      and(
        eq(trackVersions.id, input.versionId),
        eq(trackVersions.producerId, input.producerId),
        eq(trackVersions.trackId, input.trackId),
      ),
    );
}

async function completeDeletion(
  db: Db,
  operation: PreparedDeletion,
  producerId: string,
): Promise<SongDeletionResult> {
  return db.transaction(async (tx) => {
    await lockProducerAudioStorageQuota(tx, producerId);
    const [lockedOperation] = await tx
      .select()
      .from(songDeletionOperations)
      .where(
        and(
          eq(songDeletionOperations.id, operation.operationId),
          eq(songDeletionOperations.producerId, producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!lockedOperation) fail("INTEGRITY_ERROR", "The deletion operation was not found");
    const current = preparedFromRow(lockedOperation, lockedOperation.requestDigest);
    if (current.completedAt) {
      return {
        kind: current.kind,
        projectId: current.projectId,
        trackId: current.trackId,
        versionId: current.versionId,
        alreadyCompleted: true,
      };
    }
    if (!current.storageVerifiedAt) {
      fail("CONFLICT", "Stored audio deletion has not been verified yet");
    }
    await lockProjectAndPurchase(tx, current);
    await assertPreparedTargetsUnchanged(tx, current, producerId);
    await tx.execute(
      sql`select set_config('skitza.song_deletion_operation_id', ${current.operationId}, true)`,
    );

    if (current.audioManifest.length > 0) {
      await tx.delete(portfolioTracks).where(
        and(
          eq(portfolioTracks.producerId, producerId),
          inArray(
            portfolioTracks.audioR2Key,
            current.audioManifest.map((item) => item.key),
          ),
        ),
      );
    }

    if (current.kind === "version") {
      if (!current.versionId) fail("INTEGRITY_ERROR", "The Version deletion target is missing");
      await deleteVersionHistory(tx, {
        producerId,
        versionId: current.versionId,
        trackId: current.trackId,
      });
    } else {
      for (const versionId of current.targetVersionIds) {
        await deleteVersionHistory(tx, {
          producerId,
          versionId,
          trackId: current.trackId,
        });
      }
      await tx
        .delete(firstVersionUploadIntents)
        .where(
          and(
            eq(firstVersionUploadIntents.producerId, producerId),
            eq(firstVersionUploadIntents.trackId, current.trackId),
            isNotNull(firstVersionUploadIntents.completedAt),
          ),
        );
      await tx
        .delete(songPublicAccessEvents)
        .where(
          and(
            eq(songPublicAccessEvents.producerId, producerId),
            eq(songPublicAccessEvents.trackId, current.trackId),
          ),
        );
      await tx
        .delete(songPublicLinks)
        .where(
          and(
            eq(songPublicLinks.producerId, producerId),
            eq(songPublicLinks.trackId, current.trackId),
          ),
        );
      await tx
        .delete(artistHistoricalAccessGrants)
        .where(
          and(
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "track"),
            eq(artistHistoricalAccessGrants.resourceId, current.trackId),
          ),
        );
      await tx
        .update(bookings)
        .set({ songId: null })
        .where(and(eq(bookings.producerId, producerId), eq(bookings.songId, current.trackId)));
      await tx
        .delete(projectTracks)
        .where(
          and(
            eq(projectTracks.id, current.trackId),
            eq(projectTracks.projectId, current.projectId),
            eq(projectTracks.purchaseId, current.purchaseId),
          ),
        );
    }

    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(projects.id, current.projectId), eq(projects.producerId, producerId)));
    const [completed] = await tx
      .update(songDeletionOperations)
      .set({ completedAt: sql`now()` })
      .where(eq(songDeletionOperations.id, current.operationId))
      .returning({ id: songDeletionOperations.id });
    if (!completed) fail("INTEGRITY_ERROR", "The deletion operation could not be completed");
    return {
      kind: current.kind,
      projectId: current.projectId,
      trackId: current.trackId,
      versionId: current.versionId,
      alreadyCompleted: false,
    };
  });
}

export async function permanentlyDeleteSongVersion(
  db: Db,
  storage: SongDeletionStoragePort,
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    versionId: string;
  }>,
): Promise<SongDeletionResult> {
  const prepared = await prepareVersionDeletion(db, input);
  const verified = await verifyStorageDeletion(db, storage, prepared, input.producerId);
  return completeDeletion(db, verified, input.producerId);
}

export async function permanentlyDeleteSong(
  db: Db,
  storage: SongDeletionStoragePort,
  input: Readonly<{
    producerId: string;
    actorClerkUserId: string;
    operationKey: string;
    trackId: string;
  }>,
): Promise<SongDeletionResult> {
  const prepared = await prepareSongDeletion(db, input);
  const verified = await verifyStorageDeletion(db, storage, prepared, input.producerId);
  return completeDeletion(db, verified, input.producerId);
}
