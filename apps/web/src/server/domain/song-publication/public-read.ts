import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  projectTracks,
  projects,
  producers,
  purchaseDownloadOverrideEvents,
  purchases,
  songPublicLinks,
  sql,
  trackVersions,
  type Db,
} from "@skitza/db";

import type { AudioObjectRequest } from "~/server/domain/audio-delivery/service";
import { projectAdvisoryLockKey } from "~/server/domain/project-lifecycle/lock";
import {
  purchaseLedgerAdvisoryLockKey,
  purchaseLedgerRepositoryForTransaction,
} from "~/server/domain/purchase-ledger/db";
import { readPurchaseLedger } from "~/server/domain/purchase-ledger/service";

import {
  createPortfolioAudioCapability,
  type PortfolioAudioCapabilityPayload,
  verifyPortfolioAudioCapability,
} from "./audio-capability";
import {
  isPublicStoredVersionCandidate,
  selectPublicStoredVersions,
  type PublicSongScope,
  type PublicStoredVersionCandidate,
} from "./read-model";
import { hashSongPublicToken, verifySongPublicToken, type SongPublicTokenPayload } from "./tokens";
import { publicPortfolioSongAudioPath, publicSongAudioPath, publicSongDownloadPath } from "./urls";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type DiscoveredScope = PublicSongScope &
  Readonly<{
    projectId: string;
    linkId: string | null;
  }>;

export class SongPublicReadError extends Error {
  constructor() {
    super("Public song was not found");
    this.name = "SongPublicReadError";
  }
}

function notFound(): never {
  throw new SongPublicReadError();
}

async function discoverLinkScope(
  tx: TransactionDb,
  payload: SongPublicTokenPayload,
): Promise<DiscoveredScope> {
  const [scope] = await tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: songPublicLinks.purchaseId,
      producerId: songPublicLinks.producerId,
      trackId: songPublicLinks.trackId,
      linkId: songPublicLinks.id,
    })
    .from(songPublicLinks)
    .innerJoin(
      projectTracks,
      and(
        eq(projectTracks.id, songPublicLinks.trackId),
        eq(projectTracks.purchaseId, songPublicLinks.purchaseId),
      ),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, songPublicLinks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, songPublicLinks.producerId),
      ),
    )
    .where(eq(songPublicLinks.id, payload.linkId))
    .limit(1);
  if (!scope) notFound();
  return scope;
}

async function discoverPortfolioScope(
  tx: TransactionDb,
  payload: PortfolioAudioCapabilityPayload,
): Promise<DiscoveredScope> {
  const [scope] = await tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      producerId: purchases.producerId,
      trackId: projectTracks.id,
    })
    .from(projectTracks)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, payload.producerId),
      ),
    )
    .where(and(eq(projectTracks.id, payload.trackId), eq(purchases.producerId, payload.producerId)))
    .limit(1);
  if (!scope) notFound();
  return { ...scope, linkId: null };
}

async function lockCoreRows(tx: TransactionDb, scope: DiscoveredScope): Promise<void> {
  const [producer] = await tx
    .select({ id: producers.id })
    .from(producers)
    .where(and(eq(producers.id, scope.producerId), isNull(producers.closedAt)))
    .limit(1)
    .for("share");
  if (!producer) notFound();

  const [project] = await tx
    .select({ id: projects.id, producerId: projects.producerId })
    .from(projects)
    .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)))
    .limit(1)
    .for("share");
  const [purchase] = await tx
    .select({
      id: purchases.id,
      producerId: purchases.producerId,
      projectId: purchases.projectId,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.id, scope.purchaseId),
        eq(purchases.producerId, scope.producerId),
        eq(purchases.projectId, scope.projectId),
      ),
    )
    .limit(1)
    .for("share");
  const [track] = await tx
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
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
    .for("share");
  if (!project || !purchase || !track) notFound();
}

async function lockCoreScope(tx: TransactionDb, scope: DiscoveredScope): Promise<void> {
  // Anonymous reads may proceed together, while publication/deletion writers
  // retain the matching exclusive advisory locks. This preserves the atomic
  // reset/disable boundary without serializing every guest or range request.
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope.purchaseId}, 0))`,
  );
  await lockCoreRows(tx, scope);
}

async function lockCommercialLinkScope(tx: TransactionDb, scope: DiscoveredScope): Promise<void> {
  // Match the established audio-delivery lock graph before reading money:
  // lifecycle project, publication/deletion project + purchase, then ledger.
  // Shared variants allow guest reads together while payment, override,
  // deletion, and link writers still form one exact authorization snapshot.
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${projectAdvisoryLockKey(scope.projectId)}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${scope.purchaseId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${purchaseLedgerAdvisoryLockKey(scope.purchaseId)}, 0))`,
  );
  await lockCoreRows(tx, scope);
}

function versionSelection(): {
  id: typeof trackVersions.id;
  trackId: typeof trackVersions.trackId;
  purchaseId: typeof trackVersions.purchaseId;
  producerId: typeof trackVersions.producerId;
  label: typeof trackVersions.label;
  durationMs: typeof trackVersions.durationMs;
  peaks: typeof trackVersions.peaks;
  uploadedAt: typeof trackVersions.uploadedAt;
  producerMarkedFinalAt: typeof trackVersions.producerMarkedFinalAt;
  audioUrl: typeof trackVersions.audioUrl;
  audioR2Key: typeof trackVersions.audioR2Key;
  sizeBytes: typeof trackVersions.sizeBytes;
  audioObjectEtag: typeof trackVersions.audioObjectEtag;
  audioIdentityFingerprint: typeof trackVersions.audioIdentityFingerprint;
  audioDeletedAt: typeof trackVersions.audioDeletedAt;
  pendingAudioR2Key: typeof trackVersions.pendingAudioR2Key;
  pendingAudioUploadId: typeof trackVersions.pendingAudioUploadId;
  pendingAudioInitiationDigest: typeof trackVersions.pendingAudioInitiationDigest;
  pendingAudioCompletionToken: typeof trackVersions.pendingAudioCompletionToken;
  pendingAudioSizeBytes: typeof trackVersions.pendingAudioSizeBytes;
  pendingAudioStartedAt: typeof trackVersions.pendingAudioStartedAt;
  pendingAudioCreateAttemptedAt: typeof trackVersions.pendingAudioCreateAttemptedAt;
  pendingAudioCompleteAttemptedAt: typeof trackVersions.pendingAudioCompleteAttemptedAt;
  pendingAudioPartUrlsExpireAt: typeof trackVersions.pendingAudioPartUrlsExpireAt;
  pendingAudioCancelRequestedAt: typeof trackVersions.pendingAudioCancelRequestedAt;
  pendingAudioCleanupEtag: typeof trackVersions.pendingAudioCleanupEtag;
} {
  return {
    id: trackVersions.id,
    trackId: trackVersions.trackId,
    purchaseId: trackVersions.purchaseId,
    producerId: trackVersions.producerId,
    label: trackVersions.label,
    durationMs: trackVersions.durationMs,
    peaks: trackVersions.peaks,
    uploadedAt: trackVersions.uploadedAt,
    producerMarkedFinalAt: trackVersions.producerMarkedFinalAt,
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

async function lockStoredVersions(
  tx: TransactionDb,
  scope: DiscoveredScope,
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
    .for("share");
}

async function requireCurrentLink(
  tx: TransactionDb,
  scope: DiscoveredScope,
  payload: SongPublicTokenPayload,
  tokenHash: string,
): Promise<void> {
  if (!scope.linkId) notFound();
  const [link] = await tx
    .select({
      id: songPublicLinks.id,
      trackId: songPublicLinks.trackId,
      purchaseId: songPublicLinks.purchaseId,
      producerId: songPublicLinks.producerId,
      tokenVersion: songPublicLinks.tokenVersion,
      tokenHash: songPublicLinks.tokenHash,
      disabledAt: songPublicLinks.disabledAt,
    })
    .from(songPublicLinks)
    .where(
      and(
        eq(songPublicLinks.id, scope.linkId),
        eq(songPublicLinks.trackId, scope.trackId),
        eq(songPublicLinks.purchaseId, scope.purchaseId),
        eq(songPublicLinks.producerId, scope.producerId),
      ),
    )
    .limit(1)
    .for("share");
  if (
    !link ||
    link.disabledAt !== null ||
    link.tokenVersion !== payload.tokenVersion ||
    link.tokenHash !== tokenHash
  ) {
    notFound();
  }
}

function requireAudioRequest(
  row: PublicStoredVersionCandidate | undefined,
  scope: DiscoveredScope,
): AudioObjectRequest {
  if (!row || !isPublicStoredVersionCandidate(row, scope)) {
    notFound();
  }
  return {
    key: row.audioR2Key,
    objectEtag: row.audioObjectEtag,
    sizeBytes: row.sizeBytes,
    title: "Public song",
    versionLabel: row.label,
  };
}

export type PublicSongView = Readonly<{
  producer: Readonly<{
    displayName: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  }>;
  song: Readonly<{
    id: string;
    projectId: string;
    projectTitle: string;
    title: string;
    artist: string | null;
    workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
  }>;
  versions: ReadonlyArray<
    Readonly<{
      id: string;
      label: string;
      audioUrl: string;
      durationMs: number | null;
      peaks: number[] | null;
      uploadedAt: Date;
      producerMarkedFinalAt: Date | null;
    }>
  >;
}>;

export async function readPublicSong(
  db: Db,
  input: Readonly<{ secret: string; token: string }>,
): Promise<PublicSongView> {
  const payload = verifySongPublicToken(input.secret, input.token);
  const tokenHash = hashSongPublicToken(input.token);
  return db.transaction(async (tx) => {
    const scope = await discoverLinkScope(tx, payload);
    await lockCoreScope(tx, scope);
    const candidates = await lockStoredVersions(tx, scope);
    await requireCurrentLink(tx, scope, payload, tokenHash);
    const stored = selectPublicStoredVersions(candidates, scope);
    if (stored.length === 0) notFound();

    const [safe] = await tx
      .select({
        title: projectTracks.title,
        artist: projectTracks.artist,
        workflowStage: projectTracks.workflowStage,
        projectTitle: projects.title,
        displayName: producers.displayName,
        brand: producers.brand,
      })
      .from(projectTracks)
      .innerJoin(
        projects,
        and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)),
      )
      .innerJoin(producers, eq(producers.id, scope.producerId))
      .where(
        and(eq(projectTracks.id, scope.trackId), eq(projectTracks.purchaseId, scope.purchaseId)),
      )
      .limit(1);
    if (!safe) notFound();
    return {
      producer: {
        displayName: safe.displayName?.trim() || "Producer",
        logoUrl: safe.brand?.logoUrl ?? null,
        primaryColor: safe.brand?.primary ?? null,
        accentColor: safe.brand?.accent ?? null,
      },
      song: {
        id: scope.trackId,
        projectId: scope.projectId,
        projectTitle: safe.projectTitle,
        title: safe.title,
        artist: safe.artist,
        workflowStage: safe.workflowStage,
      },
      versions: stored.map((version) => ({
        ...version,
        audioUrl: publicSongAudioPath(version.id, input.token),
      })),
    };
  });
}

export type SongLinkDownloadEntitlement = Readonly<{
  purchaseId: string;
  versionId: string;
  permission: "purchase_fully_paid" | "version_override" | "payment_required";
  canDownload: boolean;
  fullyPaid: boolean;
  remainingCents: number;
  currency: string;
  overdue: boolean;
  downloadUrl: string | null;
}>;

type CommercialSongLinkSnapshot = Readonly<{
  scope: DiscoveredScope;
  candidates: readonly PublicStoredVersionCandidate[];
  entitlements: readonly SongLinkDownloadEntitlement[];
}>;

async function commercialSongLinkSnapshot(
  tx: TransactionDb,
  input: Readonly<{
    payload: SongPublicTokenPayload;
    token: string;
    tokenHash: string;
    now: Date;
  }>,
): Promise<CommercialSongLinkSnapshot> {
  const scope = await discoverLinkScope(tx, input.payload);
  await lockCommercialLinkScope(tx, scope);
  const candidates = await lockStoredVersions(tx, scope);
  await requireCurrentLink(tx, scope, input.payload, input.tokenHash);
  const stored = selectPublicStoredVersions(candidates, scope);
  if (stored.length === 0) notFound();

  const ledger = await readPurchaseLedger(
    purchaseLedgerRepositoryForTransaction(tx, {
      producerId: scope.producerId,
      purchaseId: scope.purchaseId,
    }),
    {
      producerId: scope.producerId,
      purchaseId: scope.purchaseId,
      asOf: input.now,
    },
  );
  const versionIds = stored.map((version) => version.id);
  const overrideRows = await tx
    .selectDistinctOn([purchaseDownloadOverrideEvents.versionId], {
      versionId: purchaseDownloadOverrideEvents.versionId,
      enabled: purchaseDownloadOverrideEvents.enabled,
      sequence: purchaseDownloadOverrideEvents.sequence,
    })
    .from(purchaseDownloadOverrideEvents)
    .where(
      and(
        eq(purchaseDownloadOverrideEvents.producerId, scope.producerId),
        eq(purchaseDownloadOverrideEvents.purchaseId, scope.purchaseId),
        inArray(purchaseDownloadOverrideEvents.versionId, versionIds),
      ),
    )
    .orderBy(
      purchaseDownloadOverrideEvents.versionId,
      desc(purchaseDownloadOverrideEvents.sequence),
    );
  const overrides = new Map(overrideRows.map((row) => [row.versionId, row.enabled]));
  const fullyPaid = ledger.projection.fullyPaidForDownloads;
  const overdue = ledger.projection.installments.some(
    (installment) => installment.status === "overdue" && installment.remainingCents > 0,
  );

  return {
    scope,
    candidates,
    entitlements: stored.map((version) => {
      const overrideEnabled = overrides.get(version.id) === true;
      const permission = fullyPaid
        ? "purchase_fully_paid"
        : overrideEnabled
          ? "version_override"
          : "payment_required";
      const canDownload = permission !== "payment_required";
      return {
        purchaseId: scope.purchaseId,
        versionId: version.id,
        permission,
        canDownload,
        fullyPaid,
        remainingCents: ledger.projection.remainingCents,
        currency: ledger.projection.currency,
        overdue,
        downloadUrl: canDownload ? publicSongDownloadPath(version.id, input.token) : null,
      };
    }),
  };
}

export async function readSongLinkDownloadEntitlements(
  db: Db,
  input: Readonly<{ secret: string; token: string; now?: Date }>,
): Promise<readonly SongLinkDownloadEntitlement[]> {
  const payload = verifySongPublicToken(input.secret, input.token);
  const tokenHash = hashSongPublicToken(input.token);
  return db.transaction(async (tx) => {
    const snapshot = await commercialSongLinkSnapshot(tx, {
      payload,
      token: input.token,
      tokenHash,
      now: input.now ?? new Date(),
    });
    return snapshot.entitlements;
  });
}

export async function deliverSongLinkDownload<Result>(
  db: Db,
  input: Readonly<{
    secret: string;
    token: string;
    versionId: string;
    now?: Date;
  }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const payload = verifySongPublicToken(input.secret, input.token);
  const tokenHash = hashSongPublicToken(input.token);
  return db.transaction(async (tx) => {
    const snapshot = await commercialSongLinkSnapshot(tx, {
      payload,
      token: input.token,
      tokenHash,
      now: input.now ?? new Date(),
    });
    const entitlement = snapshot.entitlements.find(
      (candidate) => candidate.versionId === input.versionId,
    );
    if (!entitlement?.canDownload) notFound();
    const selected = snapshot.candidates.find((candidate) => candidate.id === input.versionId);
    return open(requireAudioRequest(selected, snapshot.scope));
  });
}

export async function deliverSongLinkAudio<Result>(
  db: Db,
  input: Readonly<{ secret: string; token: string; versionId: string }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const payload = verifySongPublicToken(input.secret, input.token);
  const tokenHash = hashSongPublicToken(input.token);
  return db.transaction(async (tx) => {
    const scope = await discoverLinkScope(tx, payload);
    await lockCoreScope(tx, scope);
    const candidates = await lockStoredVersions(tx, scope);
    await requireCurrentLink(tx, scope, payload, tokenHash);
    const selected = candidates.find((candidate) => candidate.id === input.versionId);
    return open(requireAudioRequest(selected, scope));
  });
}

export async function deliverPortfolioSongAudio<Result>(
  db: Db,
  input: Readonly<{ secret: string; capability: string; versionId: string; now?: Date }>,
  open: (request: AudioObjectRequest) => Promise<Result>,
): Promise<Result> {
  const payload = verifyPortfolioAudioCapability(
    input.secret,
    input.capability,
    input.now ?? new Date(),
  );
  if (payload.versionId !== input.versionId) notFound();
  return db.transaction(async (tx) => {
    const scope = await discoverPortfolioScope(tx, payload);
    await lockCoreScope(tx, scope);
    const candidates = await lockStoredVersions(tx, scope);
    const [track] = await tx
      .select({ portfolioPublishedAt: projectTracks.portfolioPublishedAt })
      .from(projectTracks)
      .where(
        and(
          eq(projectTracks.id, scope.trackId),
          eq(projectTracks.projectId, scope.projectId),
          eq(projectTracks.purchaseId, scope.purchaseId),
        ),
      )
      .limit(1)
      .for("share");
    const stored = selectPublicStoredVersions(candidates, scope);
    if (
      !track?.portfolioPublishedAt ||
      track.portfolioPublishedAt.getTime() !== payload.portfolioPublishedAtEpochMs ||
      stored[0]?.id !== payload.versionId
    ) {
      notFound();
    }
    return open(
      requireAudioRequest(
        candidates.find((row) => row.id === payload.versionId),
        scope,
      ),
    );
  });
}

export type PublicPortfolioSong = Readonly<{
  id: string;
  title: string;
  artist: string | null;
  audioUrl: string;
  durationMs: number | null;
  peaks: number[] | null;
  portfolioPublishedAt: Date;
}>;

export async function listPublicPortfolioSongs(
  db: Db,
  input: Readonly<{ producerId: string; secret: string; limit?: number }>,
): Promise<PublicPortfolioSong[]> {
  return db.transaction(async (tx) => {
    const [producer] = await tx
      .select({ id: producers.id, closedAt: producers.closedAt })
      .from(producers)
      .where(and(eq(producers.id, input.producerId), isNull(producers.closedAt)))
      .limit(1)
      .for("share");
    if (!producer) return [];

    const tracks = await tx
      .select({
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
        producerId: purchases.producerId,
        trackId: projectTracks.id,
        title: projectTracks.title,
        artist: projectTracks.artist,
        portfolioPublishedAt: projectTracks.portfolioPublishedAt,
      })
      .from(projectTracks)
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, projectTracks.purchaseId),
          eq(purchases.projectId, projectTracks.projectId),
          eq(purchases.producerId, input.producerId),
        ),
      )
      .where(
        and(
          eq(purchases.producerId, input.producerId),
          sql`${projectTracks.portfolioPublishedAt} is not null`,
        ),
      )
      .orderBy(sql`${projectTracks.portfolioPublishedAt} desc`, sql`${projectTracks.id} desc`)
      .for("share", { of: projectTracks });

    const output: PublicPortfolioSong[] = [];
    for (const track of tracks) {
      if (!track.portfolioPublishedAt) continue;
      const candidates = await tx
        .select(versionSelection())
        .from(trackVersions)
        .where(
          and(
            eq(trackVersions.trackId, track.trackId),
            eq(trackVersions.purchaseId, track.purchaseId),
            eq(trackVersions.producerId, track.producerId),
          ),
        )
        .for("share");
      const newest = selectPublicStoredVersions(candidates, track)[0];
      if (!newest) continue;
      const capability = createPortfolioAudioCapability(input.secret, {
        producerId: track.producerId,
        trackId: track.trackId,
        versionId: newest.id,
        portfolioPublishedAtEpochMs: track.portfolioPublishedAt.getTime(),
      });
      output.push({
        id: track.trackId,
        title: track.title,
        artist: track.artist,
        audioUrl: publicPortfolioSongAudioPath(newest.id, capability),
        durationMs: newest.durationMs,
        peaks: newest.peaks,
        portfolioPublishedAt: track.portfolioPublishedAt,
      });
      if (output.length >= (input.limit ?? 3)) break;
    }
    return output;
  });
}
