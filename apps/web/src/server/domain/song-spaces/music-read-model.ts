import {
  and,
  asc,
  clientContacts,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  projectTracks,
  projects,
  products,
  producers,
  purchases,
  sql,
  trackComments,
  trackVersions,
  type Db,
} from "@skitza/db";

import {
  summarizeProjectSongSpaces,
  type EmptySongSpaceSlot,
  type SongSpaceProjectMode,
} from "./service";

export type MusicProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type MusicReadScope =
  | Readonly<{ kind: "producer"; producerId: string }>
  | Readonly<{ kind: "artist"; clerkUserId: string }>;

export type MusicLatestVersion = Readonly<{
  id: string;
  label: string;
  audioUrl: string | null;
  durationMs: number | null;
  uploadedAt: Date;
}>;

export type MusicHistoryVersion = Readonly<{
  id: string;
  label: string;
  uploadedAt: Date;
  audioDeletedAt: Date | null;
}>;

export type MusicAllocatedSong = Readonly<{
  kind: "song";
  id: string;
  trackId: string;
  purchaseId: string;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  title: string;
  artist: string | null;
  position: number;
  archivedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  latestVersion: MusicLatestVersion | null;
  latestHistoryVersion: MusicHistoryVersion | null;
  unreadComments: number;
  plays: 0;
}>;

export type MusicEmptySongSpace = EmptySongSpaceSlot &
  Readonly<{
    title: string;
  }>;

export type MusicPaidExtraProduct = Readonly<{
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}>;

export type MusicProjectReadModel = Readonly<{
  id: string;
  producerId: string;
  title: string;
  partnerName: string | null;
  lifecycleStatus: MusicProjectLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  latestActivityAt: Date;
  songs: readonly MusicAllocatedSong[];
  emptySlots: readonly MusicEmptySongSpace[];
  visibleCount: number;
  mode: SongSpaceProjectMode;
  paidExtraProducts: readonly MusicPaidExtraProduct[];
  noChargeAvailable: boolean;
  noChargeUnavailableReason: string | null;
}>;

export type MusicLibraryReadModel = Readonly<{
  projects: readonly MusicProjectReadModel[];
  activeProjects: readonly MusicProjectReadModel[];
}>;

type ProjectHead = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  artistContactId: string | null;
  artistContactProducerId: string | null;
  artistClerkUserId: string | null;
  artistHasProducerIdentity: boolean;
  artistContactArchivedAt: Date | null;
  title: string;
  partnerName: string | null;
  lifecycleStatus: MusicProjectLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

async function loadProjectHeads(
  db: Db,
  scope: MusicReadScope,
  projectId?: string,
): Promise<ProjectHead[]> {
  if (scope.kind === "producer") {
    const rows = await db
      .select({
        id: projects.id,
        producerId: projects.producerId,
        clientContactId: projects.clientContactId,
        artistContactId: clientContacts.id,
        artistContactProducerId: clientContacts.producerId,
        artistClerkUserId: clientContacts.clerkUserId,
        artistHasProducerIdentity: sql<boolean>`exists (
          select 1 from "producers" as "artist_identity_producer"
          where "artist_identity_producer"."clerk_user_id" = ${clientContacts.clerkUserId}
        )`,
        artistContactArchivedAt: clientContacts.archivedAt,
        title: projects.title,
        partnerName: projects.clientName,
        lifecycleStatus: projects.lifecycleStatus,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(
        clientContacts,
        and(
          eq(clientContacts.id, projects.clientContactId),
          eq(clientContacts.producerId, projects.producerId),
        ),
      )
      .where(
        projectId
          ? and(eq(projects.producerId, scope.producerId), eq(projects.id, projectId))
          : eq(projects.producerId, scope.producerId),
      )
      .orderBy(desc(projects.updatedAt), asc(projects.id));
    return rows;
  }

  const rows = await db
    .select({
      id: projects.id,
      producerId: projects.producerId,
      clientContactId: projects.clientContactId,
      artistContactId: clientContacts.id,
      artistContactProducerId: clientContacts.producerId,
      artistClerkUserId: clientContacts.clerkUserId,
      artistHasProducerIdentity: sql<boolean>`exists (
        select 1 from "producers" as "artist_identity_producer"
        where "artist_identity_producer"."clerk_user_id" = ${clientContacts.clerkUserId}
      )`,
      artistContactArchivedAt: clientContacts.archivedAt,
      title: projects.title,
      partnerName: producers.displayName,
      lifecycleStatus: projects.lifecycleStatus,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(producers, eq(producers.id, projects.producerId))
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
        eq(clientContacts.clerkUserId, scope.clerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .where(
      projectId
        ? and(eq(projects.id, projectId), ne(projects.lifecycleStatus, "waiting_for_payment"))
        : ne(projects.lifecycleStatus, "waiting_for_payment"),
    )
    .orderBy(desc(projects.updatedAt), asc(projects.id));
  return rows;
}

type NoChargeSourcePurchase = Readonly<{
  purchaseId: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  productId: string | null;
  sourceProductId: string | null;
  sourceProductProducerId: string | null;
  currency: string;
}>;

function isExplicitBoolean(value: unknown, expected: boolean): boolean {
  return typeof value === "boolean" && value === expected;
}

function noChargeAvailability(
  head: ProjectHead,
  projectPurchases: readonly NoChargeSourcePurchase[],
  unusedActiveSongSpaceCount: number,
): Readonly<{ available: boolean; reason: string | null }> {
  if (head.lifecycleStatus !== "active") {
    return {
      available: false,
      reason: "No-charge songs are available only for active projects.",
    };
  }

  const hasEligibleArtist =
    head.artistContactId === head.clientContactId &&
    head.artistContactProducerId === head.producerId &&
    head.artistContactArchivedAt === null &&
    typeof head.artistClerkUserId === "string" &&
    head.artistClerkUserId.length > 0 &&
    head.artistClerkUserId === head.artistClerkUserId.trim();
  if (!hasEligibleArtist) {
    return {
      available: false,
      reason: "A linked, signed-in artist is required before offering a no-charge song.",
    };
  }
  if (!isExplicitBoolean(head.artistHasProducerIdentity, false)) {
    return {
      available: false,
      reason: "A producer identity cannot accept an artist no-charge agreement.",
    };
  }

  const hasEligibleSource = projectPurchases.some(
    (purchase) =>
      purchase.producerId === head.producerId &&
      purchase.projectId === head.id &&
      purchase.clientContactId === head.clientContactId &&
      purchase.lifecycleStatus === "active" &&
      purchase.currency === "ILS" &&
      typeof purchase.productId === "string" &&
      purchase.productId.length > 0 &&
      purchase.sourceProductId === purchase.productId &&
      purchase.sourceProductProducerId === head.producerId,
  );
  if (!hasEligibleSource) {
    return {
        available: false,
        reason: "No active ILS product-backed purchase source was found for this project.",
      };
  }
  if (!Number.isSafeInteger(unusedActiveSongSpaceCount) || unusedActiveSongSpaceCount !== 0) {
    return {
      available: false,
      reason: "Use every existing purchased song space before offering an extra no-charge song.",
    };
  }
  return { available: true, reason: null };
}

async function buildProjectReadModels(
  db: Db,
  heads: readonly ProjectHead[],
  scope: MusicReadScope,
): Promise<MusicProjectReadModel[]> {
  if (heads.length === 0) return [];
  const projectIds = heads.map((project) => project.id);

  // A paid-extra handoff never creates or accepts a purchase for the
  // producer. It exposes only currently published per-song Store templates;
  // the artist still opens the signed-in Store flow, chooses this exact
  // project, reviews the final terms, and accepts for themselves.
  const paidExtraProducts: MusicPaidExtraProduct[] =
    scope.kind === "producer"
      ? await db
          .select({
            id: products.id,
            name: products.name,
            priceCents: products.priceCents,
            currency: products.currency,
          })
          .from(products)
          .where(
            and(
              eq(products.producerId, scope.producerId),
              eq(products.active, true),
              isNull(products.archivedAt),
              eq(products.pricingModel, "per_song"),
              gt(products.priceCents, 0),
            ),
          )
          .orderBy(asc(products.position), asc(products.id))
      : [];

  const purchaseRows = await db
      .select({
        purchaseId: purchases.id,
        producerId: purchases.producerId,
        projectId: purchases.projectId,
        clientContactId: purchases.clientContactId,
        lifecycleStatus: purchases.lifecycleStatus,
        acceptedAt: purchases.acceptedAt,
        productId: purchases.productId,
        sourceProductId: products.id,
        sourceProductProducerId: products.producerId,
        currency: purchases.currency,
        commercialSnapshot: purchases.commercialSnapshot,
      })
      .from(purchases)
      .leftJoin(
        products,
        and(eq(products.id, purchases.productId), eq(products.producerId, purchases.producerId)),
      )
      .where(inArray(purchases.projectId, projectIds))
      .orderBy(asc(purchases.acceptedAt), asc(purchases.id));
  const trackRows = await db
      .select({
        id: projectTracks.id,
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
        title: projectTracks.title,
        artist: projectTracks.artist,
        position: projectTracks.position,
        archivedAt: projectTracks.archivedAt,
        releasedAt: projectTracks.releasedAt,
        createdAt: projectTracks.createdAt,
      })
      .from(projectTracks)
      .where(inArray(projectTracks.projectId, projectIds))
      .orderBy(asc(projectTracks.position), asc(projectTracks.id));

  const trackIds = trackRows.map((track) => track.id);
  const versionRows =
    trackIds.length === 0
      ? []
      : await db
          .select({
            id: trackVersions.id,
            trackId: trackVersions.trackId,
            label: trackVersions.label,
            audioUrl: trackVersions.audioUrl,
            audioDeletedAt: trackVersions.audioDeletedAt,
            durationMs: trackVersions.durationMs,
            uploadedAt: trackVersions.uploadedAt,
          })
          .from(trackVersions)
          .where(
            and(
              inArray(trackVersions.trackId, trackIds),
              ...(scope.kind === "producer"
                ? [eq(trackVersions.producerId, scope.producerId)]
                : []),
              or(isNotNull(trackVersions.audioUrl), isNotNull(trackVersions.audioDeletedAt)),
            ),
          )
          .orderBy(desc(trackVersions.uploadedAt), desc(trackVersions.id));

  const latestVersionByTrack = new Map<string, MusicLatestVersion>();
  const latestHistoryVersionByTrack = new Map<string, MusicHistoryVersion>();
  for (const version of versionRows) {
    if (version.audioUrl === null && version.audioDeletedAt == null) continue;
    if (!latestHistoryVersionByTrack.has(version.trackId)) {
      latestHistoryVersionByTrack.set(version.trackId, {
        id: version.id,
        label: version.label,
        uploadedAt: version.uploadedAt,
        audioDeletedAt: version.audioDeletedAt ?? null,
      });
    }
    // Keep this guard in addition to the SQL predicate so alternate test/read
    // adapters cannot let an in-flight null-audio placeholder hide older
    // playable audio.
    if (version.audioUrl === null || version.audioDeletedAt != null) continue;
    if (!latestVersionByTrack.has(version.trackId)) {
      latestVersionByTrack.set(version.trackId, {
        id: version.id,
        label: version.label,
        audioUrl: version.audioUrl,
        durationMs: version.durationMs,
        uploadedAt: version.uploadedAt,
      });
    }
  }

  const commentTargetVersionByTrack = new Map<string, string>();
  for (const trackId of trackIds) {
    const version = latestVersionByTrack.get(trackId) ?? latestHistoryVersionByTrack.get(trackId);
    if (version) commentTargetVersionByTrack.set(trackId, version.id);
  }
  const commentVersionIds = [...new Set(commentTargetVersionByTrack.values())];
  const commentRows =
    commentVersionIds.length === 0
      ? []
      : await db
          .select({ versionId: trackComments.versionId })
          .from(trackComments)
          .where(
            and(
              inArray(trackComments.versionId, commentVersionIds),
              eq(trackComments.fromProducer, scope.kind === "artist"),
              isNull(trackComments.resolvedAt),
            ),
          );
  const unreadByVersion = new Map<string, number>();
  for (const comment of commentRows) {
    unreadByVersion.set(
      comment.versionId,
      (unreadByVersion.get(comment.versionId) ?? 0) + 1,
    );
  }

  const models: MusicProjectReadModel[] = [];
  for (const head of heads) {
    const projectPurchases = purchaseRows.filter((purchase) => purchase.projectId === head.id);
    const projectTracksList = trackRows.filter((track) => track.projectId === head.id);
    const summary = summarizeProjectSongSpaces({
      producerId: head.producerId,
      projectId: head.id,
      purchases: projectPurchases.map((purchase) => ({
          producerId: purchase.producerId,
          projectId: purchase.projectId,
          purchaseId: purchase.purchaseId,
          lifecycleStatus: purchase.lifecycleStatus,
          includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
          acceptedAt: purchase.acceptedAt,
        })),
      tracks: projectTracksList.map((track) => ({
        id: track.id,
        producerId: head.producerId,
        projectId: track.projectId,
        purchaseId: track.purchaseId,
        title: track.title,
        artist: track.artist,
        position: track.position,
      })),
    });

    const tracksById = new Map(projectTracksList.map((track) => [track.id, track]));
    const purchaseLifecycleById = new Map(
      projectPurchases.map((purchase) => [purchase.purchaseId, purchase.lifecycleStatus]),
    );
    const songs = summary.tracks.map((track): MusicAllocatedSong => {
      const stored = tracksById.get(track.id);
      if (!stored) throw new Error("Song-space read model lost an allocated track");
      const latestVersion = latestVersionByTrack.get(track.id) ?? null;
      const latestHistoryVersion = latestHistoryVersionByTrack.get(track.id) ?? null;
      const purchaseLifecycleStatus = purchaseLifecycleById.get(track.purchaseId);
      if (!purchaseLifecycleStatus) {
        throw new Error("Song-space read model lost an allocated song purchase");
      }
      return {
        kind: "song",
        id: track.id,
        trackId: track.id,
        purchaseId: track.purchaseId,
        purchaseLifecycleStatus,
        title: track.title,
        artist: track.artist,
        position: track.position,
        archivedAt: stored.archivedAt,
        releasedAt: stored.releasedAt,
        createdAt: stored.createdAt,
        latestVersion,
        latestHistoryVersion,
        unreadComments:
          unreadByVersion.get(commentTargetVersionByTrack.get(track.id) ?? "") ?? 0,
        plays: 0,
      };
    });
    const emptySlots = summary.emptySlots.map(
      (slot): MusicEmptySongSpace => ({ ...slot, title: slot.label }),
    );
    const latestVersionAt = songs.reduce<Date | null>((latest, song) => {
      const uploadedAt = song.latestVersion?.uploadedAt;
      return uploadedAt && (!latest || uploadedAt > latest) ? uploadedAt : latest;
    }, null);
    const noCharge = noChargeAvailability(head, projectPurchases, summary.emptySlots.length);

    models.push({
      id: head.id,
      producerId: head.producerId,
      title: head.title,
      partnerName: head.partnerName,
      lifecycleStatus: head.lifecycleStatus,
      createdAt: head.createdAt,
      updatedAt: head.updatedAt,
      latestActivityAt:
        latestVersionAt && latestVersionAt > head.updatedAt ? latestVersionAt : head.updatedAt,
      songs,
      emptySlots,
      visibleCount: summary.visibleCount,
      mode: summary.mode,
      paidExtraProducts,
      noChargeAvailable: noCharge.available,
      noChargeUnavailableReason: noCharge.reason,
    });
  }

  models.sort((left, right) => {
    const activityOrder = right.latestActivityAt.getTime() - left.latestActivityAt.getTime();
    return activityOrder !== 0 ? activityOrder : left.id.localeCompare(right.id);
  });
  return models;
}

export async function listMusicSongSpaces(
  db: Db,
  scope: MusicReadScope,
): Promise<MusicLibraryReadModel> {
  return db.transaction(
    async (tx) => {
      // Drizzle's transaction client exposes the same select/query surface as
      // Db. Keeping every dependent row in one snapshot prevents a purchase
      // and its allocated track from being observed on opposite sides of a
      // concurrent commit.
      const snapshotDb = tx as unknown as Db;
      const heads = await loadProjectHeads(snapshotDb, scope);
      const allProjects = await buildProjectReadModels(snapshotDb, heads, scope);
      const projectsWithSpaces = allProjects.filter((project) => project.visibleCount > 0);
      return {
        projects: projectsWithSpaces,
        activeProjects: allProjects.filter((project) => project.lifecycleStatus === "active"),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function getMusicProjectSongSpaces(
  db: Db,
  scope: MusicReadScope,
  projectId: string,
): Promise<MusicProjectReadModel | null> {
  return db.transaction(
    async (tx) => {
      const snapshotDb = tx as unknown as Db;
      const heads = await loadProjectHeads(snapshotDb, scope, projectId);
      const [project] = await buildProjectReadModels(snapshotDb, heads, scope);
      return project ?? null;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
