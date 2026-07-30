import {
  and,
  asc,
  artistHistoricalAccessGrants,
  artistProfiles,
  bookings,
  clientContacts,
  desc,
  eq,
  isNull,
  paymentProofs,
  producers,
  purchaseInstallments,
  purchaseSessionAllowances,
  projectTracks,
  projects,
  purchases,
  trackComments,
  trackVersions,
  type Db,
} from "@skitza/db";

import {
  AudioDeliveryDomainError,
  requireAuthorizedStoredAudio,
  type AudioDeliveryContext,
} from "~/server/domain/audio-delivery/policy";
import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import type { AudioObjectRequest } from "~/server/domain/audio-delivery/service";
import { createProofEvidenceToken } from "~/server/domain/payment-proofs/tokens";

export type ArtistHistoricalResourceType =
  (typeof artistHistoricalAccessGrants.$inferSelect)["resourceType"];

export async function hasArtistHistoricalGrant(
  db: Db,
  input: {
    clerkUserId: string;
    producerId: string;
    resourceType: ArtistHistoricalResourceType;
    resourceId: string;
  },
): Promise<boolean> {
  const [row] = await db
    .select({ resourceId: artistHistoricalAccessGrants.resourceId })
    .from(artistHistoricalAccessGrants)
    .where(
      and(
        eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
        eq(artistHistoricalAccessGrants.producerId, input.producerId),
        eq(artistHistoricalAccessGrants.resourceType, input.resourceType),
        eq(artistHistoricalAccessGrants.resourceId, input.resourceId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function isArtistPastStudio(
  db: Db,
  input: { clerkUserId: string; producerId: string },
): Promise<boolean> {
  const [studioAllowed, activeRows] = await Promise.all([
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "studio",
      resourceId: input.producerId,
    }),
    db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, input.clerkUserId),
          eq(clientContacts.producerId, input.producerId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .limit(1),
  ]);
  return studioAllowed && activeRows[0] === undefined;
}

export async function listArtistPastStudios(db: Db, clerkUserId: string) {
  const [activeRows, grantedRows] = await Promise.all([
    db
      .selectDistinct({ producerId: clientContacts.producerId })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      ),
    db
      .select({
        producerId: producers.id,
        name: producers.displayName,
        slug: producers.slug,
        brand: producers.brand,
        disconnectedAt: artistHistoricalAccessGrants.disconnectedAt,
      })
      .from(artistHistoricalAccessGrants)
      .innerJoin(producers, eq(producers.id, artistHistoricalAccessGrants.producerId))
      .where(
        and(
          eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
          eq(artistHistoricalAccessGrants.resourceType, "studio"),
        ),
      )
      .orderBy(desc(artistHistoricalAccessGrants.disconnectedAt)),
  ]);

  const activeProducerIds = new Set(activeRows.map((row) => row.producerId));
  return grantedRows
    .filter((row) => !activeProducerIds.has(row.producerId))
    .map((row) => ({
      producerId: row.producerId,
      name: row.name ?? "Studio",
      slug: row.slug,
      logoUrl: row.brand?.logoUrl ?? null,
      disconnectedAt: row.disconnectedAt,
    }));
}

export async function loadArtistPastStudio(
  db: Db,
  clerkUserId: string,
  producerId: string,
) {
  if (!(await isArtistPastStudio(db, { clerkUserId, producerId }))) return null;

  const [studio, projectRows, songRows, versionRows, proofRows, sessionRows] =
    await Promise.all([
      db
        .select({
          producerId: producers.id,
          name: producers.displayName,
          slug: producers.slug,
          brand: producers.brand,
        })
        .from(producers)
        .where(eq(producers.id, producerId))
        .limit(1),
      db
        .select({
          id: projects.id,
          title: projects.title,
          lifecycleStatus: projects.lifecycleStatus,
          createdAt: projects.createdAt,
        })
        .from(artistHistoricalAccessGrants)
        .innerJoin(
          projects,
          and(
            eq(projects.id, artistHistoricalAccessGrants.resourceId),
            eq(projects.producerId, artistHistoricalAccessGrants.producerId),
          ),
        )
        .where(
          and(
            eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "project"),
          ),
        )
        .orderBy(desc(projects.updatedAt)),
      db
        .select({
          id: projectTracks.id,
          projectId: projectTracks.projectId,
          title: projectTracks.title,
          artist: projectTracks.artist,
          createdAt: projectTracks.createdAt,
        })
        .from(artistHistoricalAccessGrants)
        .innerJoin(
          projectTracks,
          eq(projectTracks.id, artistHistoricalAccessGrants.resourceId),
        )
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "track"),
            eq(projects.producerId, producerId),
          ),
        )
        .orderBy(desc(projectTracks.createdAt)),
      db
        .select({
          id: trackVersions.id,
          trackId: trackVersions.trackId,
          label: trackVersions.label,
          uploadedAt: trackVersions.uploadedAt,
        })
        .from(artistHistoricalAccessGrants)
        .innerJoin(
          trackVersions,
          and(
            eq(trackVersions.id, artistHistoricalAccessGrants.resourceId),
            eq(trackVersions.producerId, artistHistoricalAccessGrants.producerId),
          ),
        )
        .innerJoin(
          projectTracks,
          and(
            eq(projectTracks.id, trackVersions.trackId),
            eq(projectTracks.purchaseId, trackVersions.purchaseId),
          ),
        )
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "track_version"),
            eq(projects.producerId, producerId),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt), desc(trackVersions.id)),
      db
        .select({
          id: paymentProofs.id,
          purchaseId: paymentProofs.purchaseId,
          status: paymentProofs.status,
          amountCents: paymentProofs.amountCents,
          currency: paymentProofs.currency,
          createdAt: paymentProofs.createdAt,
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(artistHistoricalAccessGrants)
        .innerJoin(
          paymentProofs,
          and(
            eq(paymentProofs.id, artistHistoricalAccessGrants.resourceId),
            eq(paymentProofs.producerId, artistHistoricalAccessGrants.producerId),
          ),
        )
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, paymentProofs.purchaseId),
            eq(purchases.producerId, paymentProofs.producerId),
          ),
        )
        .where(
          and(
            eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "payment_proof"),
          ),
        )
        .orderBy(desc(paymentProofs.createdAt)),
      db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          status: bookings.status,
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(artistHistoricalAccessGrants)
        .innerJoin(
          bookings,
          and(
            eq(bookings.id, artistHistoricalAccessGrants.resourceId),
            eq(bookings.producerId, artistHistoricalAccessGrants.producerId),
          ),
        )
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .where(
          and(
            eq(artistHistoricalAccessGrants.artistClerkUserId, clerkUserId),
            eq(artistHistoricalAccessGrants.producerId, producerId),
            eq(artistHistoricalAccessGrants.resourceType, "booking"),
          ),
        )
        .orderBy(desc(bookings.startsAt)),
    ]);

  const studioRow = studio[0];
  if (!studioRow) return null;

  const productName = (
    snapshot: (typeof purchases.$inferSelect)["commercialSnapshot"],
  ) => snapshot.productOrOfferName.trim() || "Purchase";

  return {
    studio: {
      producerId: studioRow.producerId,
      name: studioRow.name ?? "Studio",
      slug: studioRow.slug,
      logoUrl: studioRow.brand?.logoUrl ?? null,
    },
    projects: projectRows,
    songs: songRows.map((song) => ({
      ...song,
      versions: versionRows.filter((version) => version.trackId === song.id),
    })),
    proofs: proofRows.map((row) => ({
      id: row.id,
      purchaseId: row.purchaseId,
      status: row.status,
      amountCents: row.amountCents,
      currency: row.currency,
      createdAt: row.createdAt,
      productName: productName(row.commercialSnapshot),
    })),
    sessions: sessionRows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      durationMin: row.durationMin,
      status: row.status,
      productName: productName(row.commercialSnapshot),
    })),
  };
}

type HistoricalVersionRow = Readonly<{
  producerId: string;
  producerClerkUserId: string;
  producerName: string | null;
  projectId: string;
  projectProducerId: string;
  projectClientContactId: string;
  projectTitle: string;
  purchaseId: string;
  purchaseProducerId: string;
  purchaseProjectId: string;
  purchaseClientContactId: string;
  purchaseCurrency: string;
  artistId: string;
  artistProducerId: string;
  artistClerkUserId: string | null;
  artistArchivedAt: Date | null;
  trackId: string;
  trackProjectId: string;
  trackPurchaseId: string;
  trackTitle: string;
  trackArtist: string | null;
  versionId: string;
  versionProducerId: string;
  versionTrackId: string;
  versionPurchaseId: string;
  versionLabel: string;
  versionDescription: string | null;
  versionDurationMs: number | null;
  versionUploadedAt: Date;
  audioUrl: string | null;
  audioR2Key: string | null;
  audioObjectEtag: string | null;
  audioIdentityFingerprint: string | null;
  audioSizeBytes: number | null;
  audioDeletedAt: Date | null;
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
}>;

function historicalAudioContext(row: HistoricalVersionRow): AudioDeliveryContext {
  return {
    producer: {
      id: row.producerId,
      clerkUserId: row.producerClerkUserId,
    },
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
      sizeBytes: row.audioSizeBytes,
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
    ledger: null,
    latestOverride: null,
  };
}

function historicalAudioRequest(row: HistoricalVersionRow): AudioObjectRequest {
  return {
    ...requireAuthorizedStoredAudio(historicalAudioContext(row)),
    title: row.trackTitle,
    versionLabel: row.versionLabel,
  };
}

async function loadHistoricalVersionRow(
  db: Db,
  input: { clerkUserId: string; producerId: string; versionId: string },
): Promise<HistoricalVersionRow | null> {
  if (!(await isArtistPastStudio(db, input))) return null;

  const [row] = await db
    .select({
      producerId: producers.id,
      producerClerkUserId: producers.clerkUserId,
      producerName: producers.displayName,
      projectId: projects.id,
      projectProducerId: projects.producerId,
      projectClientContactId: projects.clientContactId,
      projectTitle: projects.title,
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
      trackArtist: projectTracks.artist,
      versionId: trackVersions.id,
      versionProducerId: trackVersions.producerId,
      versionTrackId: trackVersions.trackId,
      versionPurchaseId: trackVersions.purchaseId,
      versionLabel: trackVersions.label,
      versionDescription: trackVersions.description,
      versionDurationMs: trackVersions.durationMs,
      versionUploadedAt: trackVersions.uploadedAt,
      audioUrl: trackVersions.audioUrl,
      audioR2Key: trackVersions.audioR2Key,
      audioObjectEtag: trackVersions.audioObjectEtag,
      audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
      audioSizeBytes: trackVersions.sizeBytes,
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
    .from(artistHistoricalAccessGrants)
    .innerJoin(
      trackVersions,
      and(
        eq(trackVersions.id, artistHistoricalAccessGrants.resourceId),
        eq(trackVersions.producerId, artistHistoricalAccessGrants.producerId),
      ),
    )
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
        eq(purchases.producerId, trackVersions.producerId),
        eq(purchases.projectId, projectTracks.projectId),
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
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchases.producerId))
    .where(
      and(
        eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
        eq(artistHistoricalAccessGrants.producerId, input.producerId),
        eq(artistHistoricalAccessGrants.resourceType, "track_version"),
        eq(artistHistoricalAccessGrants.resourceId, input.versionId),
        eq(trackVersions.id, input.versionId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [trackAllowed, projectAllowed, purchaseAllowed] = await Promise.all([
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "track",
      resourceId: row.trackId,
    }),
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "project",
      resourceId: row.projectId,
    }),
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "purchase",
      resourceId: row.purchaseId,
    }),
  ]);
  return trackAllowed && projectAllowed && purchaseAllowed ? row : null;
}

export async function loadArtistHistoricalVersion(
  db: Db,
  input: { clerkUserId: string; producerId: string; versionId: string },
) {
  const row = await loadHistoricalVersionRow(db, input);
  if (!row) return null;

  const [downloadAllowed, versionRows, commentRows] = await Promise.all([
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "track_version_download",
      resourceId: row.versionId,
    }),
    db
      .select({
        id: trackVersions.id,
        label: trackVersions.label,
        uploadedAt: trackVersions.uploadedAt,
      })
      .from(artistHistoricalAccessGrants)
      .innerJoin(
        trackVersions,
        and(
          eq(trackVersions.id, artistHistoricalAccessGrants.resourceId),
          eq(trackVersions.producerId, artistHistoricalAccessGrants.producerId),
        ),
      )
      .where(
        and(
          eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
          eq(artistHistoricalAccessGrants.producerId, input.producerId),
          eq(artistHistoricalAccessGrants.resourceType, "track_version"),
          eq(trackVersions.trackId, row.trackId),
        ),
      )
      .orderBy(desc(trackVersions.uploadedAt), desc(trackVersions.id)),
    db
      .select({
        id: trackComments.id,
        body: trackComments.body,
        timestampMs: trackComments.timestampMs,
        authorName: trackComments.authorName,
      })
      .from(artistHistoricalAccessGrants)
      .innerJoin(
        trackComments,
        and(
          eq(trackComments.id, artistHistoricalAccessGrants.resourceId),
          eq(trackComments.producerId, artistHistoricalAccessGrants.producerId),
        ),
      )
      .where(
        and(
          eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
          eq(artistHistoricalAccessGrants.producerId, input.producerId),
          eq(artistHistoricalAccessGrants.resourceType, "track_comment"),
          eq(trackComments.versionId, row.versionId),
        ),
      )
      .orderBy(asc(trackComments.timestampMs), asc(trackComments.createdAt)),
  ]);

  let playable = false;
  try {
    historicalAudioRequest(row);
    playable = true;
  } catch (error) {
    if (!(error instanceof AudioDeliveryDomainError)) throw error;
  }

  return {
    studio: {
      producerId: row.producerId,
      name: row.producerName ?? "Studio",
    },
    project: {
      id: row.projectId,
      title: row.projectTitle,
    },
    song: {
      id: row.trackId,
      title: row.trackTitle,
      artist: row.trackArtist,
    },
    version: {
      id: row.versionId,
      label: row.versionLabel,
      description: row.versionDescription,
      durationMs: row.versionDurationMs,
      uploadedAt: row.versionUploadedAt,
      audioUrl: playable
        ? `/api/audio/history/${encodeURIComponent(input.producerId)}/${encodeURIComponent(
            row.versionId,
          )}`
        : null,
      downloadUrl:
        playable && downloadAllowed
          ? `/api/audio/history/${encodeURIComponent(input.producerId)}/${encodeURIComponent(
              row.versionId,
            )}?download=1`
          : null,
    },
    versions: versionRows,
    comments: commentRows,
  };
}

export async function loadArtistHistoricalAudioRequest(
  db: Db,
  input: {
    clerkUserId: string;
    producerId: string;
    versionId: string;
    download: boolean;
  },
): Promise<AudioObjectRequest | null> {
  const row = await loadHistoricalVersionRow(db, input);
  if (!row) return null;
  if (
    input.download &&
    !(await hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "track_version_download",
      resourceId: row.versionId,
    }))
  ) {
    return null;
  }
  try {
    return historicalAudioRequest(row);
  } catch (error) {
    if (error instanceof AudioDeliveryDomainError) return null;
    throw error;
  }
}

export async function loadArtistHistoricalProof(
  db: Db,
  input: {
    clerkUserId: string;
    producerId: string;
    proofId: string;
    serverSecret: string;
    now?: Date;
  },
) {
  if (!(await isArtistPastStudio(db, input))) return null;
  const [row] = await db
    .select({
      proofId: paymentProofs.id,
      purchaseId: paymentProofs.purchaseId,
      installmentId: paymentProofs.installmentId,
      installmentPosition: purchaseInstallments.position,
      amountCents: paymentProofs.amountCents,
      currency: paymentProofs.currency,
      status: paymentProofs.status,
      originalFileName: paymentProofs.originalFileName,
      contentType: paymentProofs.contentType,
      sizeBytes: paymentProofs.sizeBytes,
      note: paymentProofs.note,
      rejectionNote: paymentProofs.rejectionNote,
      confirmedAt: paymentProofs.confirmedAt,
      rejectedAt: paymentProofs.rejectedAt,
      createdAt: paymentProofs.createdAt,
      producerId: producers.id,
      producerName: producers.displayName,
      projectId: projects.id,
      projectTitle: projects.title,
      refNumber: purchases.refNumber,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(artistHistoricalAccessGrants)
    .innerJoin(
      paymentProofs,
      and(
        eq(paymentProofs.id, artistHistoricalAccessGrants.resourceId),
        eq(paymentProofs.producerId, artistHistoricalAccessGrants.producerId),
      ),
    )
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, paymentProofs.purchaseId),
        eq(purchases.producerId, paymentProofs.producerId),
        eq(purchases.projectId, paymentProofs.projectId),
        eq(purchases.clientContactId, paymentProofs.clientContactId),
      ),
    )
    .innerJoin(
      purchaseInstallments,
      and(
        eq(purchaseInstallments.id, paymentProofs.installmentId),
        eq(purchaseInstallments.purchaseId, paymentProofs.purchaseId),
        eq(purchaseInstallments.producerId, paymentProofs.producerId),
      ),
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, paymentProofs.projectId),
        eq(projects.producerId, paymentProofs.producerId),
        eq(projects.clientContactId, paymentProofs.clientContactId),
      ),
    )
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, paymentProofs.clientContactId),
        eq(clientContacts.producerId, paymentProofs.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
      ),
    )
    .innerJoin(producers, eq(producers.id, paymentProofs.producerId))
    .where(
      and(
        eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
        eq(artistHistoricalAccessGrants.producerId, input.producerId),
        eq(artistHistoricalAccessGrants.resourceType, "payment_proof"),
        eq(artistHistoricalAccessGrants.resourceId, input.proofId),
        eq(paymentProofs.id, input.proofId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [purchaseAllowed, projectAllowed] = await Promise.all([
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "purchase",
      resourceId: row.purchaseId,
    }),
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "project",
      resourceId: row.projectId,
    }),
  ]);
  if (!purchaseAllowed || !projectAllowed) return null;

  const token = createProofEvidenceToken(
    input.serverSecret,
    {
      proofId: row.proofId,
      viewerClerkUserId: input.clerkUserId,
      viewerRole: "artist",
    },
    input.now,
  );
  return {
    ...row,
    producerName: row.producerName ?? "Studio",
    productName: row.commercialSnapshot.productOrOfferName.trim() || "Purchase",
    evidenceUrl: `/api/payment-proofs/evidence?token=${encodeURIComponent(token)}`,
  };
}

export async function loadArtistHistoricalSession(
  db: Db,
  input: { clerkUserId: string; producerId: string; sessionId: string },
) {
  if (!(await isArtistPastStudio(db, input))) return null;
  const [sessionRows, profileRows] = await Promise.all([
    db
      .select({
        id: bookings.id,
        producerId: producers.id,
        producerName: producers.displayName,
        producerTimezone: producers.timezone,
        projectId: projects.id,
        projectTitle: projects.title,
        purchaseId: purchases.id,
        productNameSnapshot: purchases.commercialSnapshot,
        startsAt: bookings.startsAt,
        durationMin: bookings.durationMin,
        status: bookings.status,
        outcome: bookings.outcome,
        locationType: purchaseSessionAllowances.locationType,
        createdAt: bookings.createdAt,
      })
      .from(artistHistoricalAccessGrants)
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, artistHistoricalAccessGrants.resourceId),
          eq(bookings.producerId, artistHistoricalAccessGrants.producerId),
        ),
      )
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, bookings.purchaseId),
          eq(purchases.producerId, bookings.producerId),
          eq(purchases.projectId, bookings.projectId),
        ),
      )
      .innerJoin(
        purchaseSessionAllowances,
        and(
          eq(purchaseSessionAllowances.id, bookings.sessionAllowanceId),
          eq(purchaseSessionAllowances.purchaseId, bookings.purchaseId),
          eq(purchaseSessionAllowances.producerId, bookings.producerId),
        ),
      )
      .innerJoin(
        projects,
        and(
          eq(projects.id, bookings.projectId),
          eq(projects.producerId, bookings.producerId),
          eq(projects.clientContactId, purchases.clientContactId),
        ),
      )
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, purchases.clientContactId),
          eq(clientContacts.producerId, purchases.producerId),
          eq(clientContacts.clerkUserId, input.clerkUserId),
        ),
      )
      .innerJoin(producers, eq(producers.id, bookings.producerId))
      .where(
        and(
          eq(artistHistoricalAccessGrants.artistClerkUserId, input.clerkUserId),
          eq(artistHistoricalAccessGrants.producerId, input.producerId),
          eq(artistHistoricalAccessGrants.resourceType, "booking"),
          eq(artistHistoricalAccessGrants.resourceId, input.sessionId),
          eq(bookings.id, input.sessionId),
        ),
      )
      .limit(1),
    db
      .select({ timezone: artistProfiles.timezone })
      .from(artistProfiles)
      .where(eq(artistProfiles.clerkUserId, input.clerkUserId))
      .limit(1),
  ]);
  const row = sessionRows[0];
  if (!row) return null;

  const [purchaseAllowed, projectAllowed] = await Promise.all([
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "purchase",
      resourceId: row.purchaseId,
    }),
    hasArtistHistoricalGrant(db, {
      ...input,
      resourceType: "project",
      resourceId: row.projectId,
    }),
  ]);
  if (!purchaseAllowed || !projectAllowed) return null;

  return {
    ...row,
    producerName: row.producerName ?? "Studio",
    artistTimezone: profileRows[0]?.timezone ?? row.producerTimezone,
    productName: row.productNameSnapshot.productOrOfferName.trim() || "Session",
  };
}
