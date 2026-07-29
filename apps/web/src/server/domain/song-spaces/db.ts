import { and, asc, desc, eq, projectTracks, projects, purchases, sql, type Db } from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import {
  SongSpaceDomainError,
  type SongSpaceAllocationScope,
  type SongSpaceAtomicTransaction,
  type SongSpaceProjectSnapshot,
  type SongSpaceRepository,
} from "./service";

function purchaseAdvisoryLockKey(purchaseId: string): string {
  const normalized = purchaseId.trim();
  if (!normalized) throw new Error("Purchase id must not be empty");
  return normalized;
}

function regularOperationAdvisoryLockKey(scope: SongSpaceAllocationScope): string {
  // The deterministic id is producer + operation-key scoped. This lock must
  // come before any project-specific lock so cross-project reuse of one
  // operation serializes before the deterministic row lookup.
  return `song-space:regular:${scope.producerId}:${scope.songSpaceId}`;
}

function runPurchaseOwnedAllocation<T>(
  db: Db,
  scope: SongSpaceAllocationScope,
  work: (transaction: SongSpaceAtomicTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${regularOperationAdvisoryLockKey(scope)}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(scope.projectId)}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${purchaseAdvisoryLockKey(scope.purchaseId)}, 0))`,
    );

    return work({
      findSongSpaceByIdForUpdate: async (id) => {
        const [row] = await tx
          .select({
            id: projectTracks.id,
            producerId: projects.producerId,
            projectId: projectTracks.projectId,
            purchaseId: projectTracks.purchaseId,
            title: projectTracks.title,
            artist: projectTracks.artist,
            position: projectTracks.position,
          })
          .from(projectTracks)
          .innerJoin(projects, eq(projects.id, projectTracks.projectId))
          .where(eq(projectTracks.id, id))
          .limit(1)
          .for("update");
        return row ?? null;
      },
      getActivePurchaseForUpdate: async (lockedScope) => {
        const [purchase] = await tx
          .select({
            id: purchases.id,
            producerId: purchases.producerId,
            projectId: purchases.projectId,
            lifecycleStatus: purchases.lifecycleStatus,
            projectLifecycleStatus: projects.lifecycleStatus,
            commercialSnapshot: purchases.commercialSnapshot,
          })
          .from(purchases)
          .innerJoin(
            projects,
            and(
              eq(projects.id, purchases.projectId),
              eq(projects.producerId, purchases.producerId),
            ),
          )
          .where(
            and(
              eq(purchases.id, lockedScope.purchaseId),
              eq(purchases.projectId, lockedScope.projectId),
              eq(purchases.producerId, lockedScope.producerId),
              eq(purchases.lifecycleStatus, "active"),
              eq(projects.lifecycleStatus, "active"),
            ),
          )
          .limit(1)
          .for("update");

        return purchase
          ? {
              purchaseId: purchase.id,
              producerId: purchase.producerId,
              projectId: purchase.projectId,
              lifecycleStatus: "active" as const,
              projectLifecycleStatus: "active" as const,
              includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
            }
          : null;
      },
      countPurchaseOwnedSongSpaces: async (lockedScope) => {
        // Deliberately count every row, including archived tracks and tracks
        // whose first upload failed. Allocations are never recycled.
        const rows = await tx
          .select({ id: projectTracks.id })
          .from(projectTracks)
          .where(
            and(
              eq(projectTracks.projectId, lockedScope.projectId),
              eq(projectTracks.purchaseId, lockedScope.purchaseId),
            ),
          );
        return rows.length;
      },
      nextProjectPositionForUpdate: async (lockedScope) => {
        const [last] = await tx
          .select({ position: projectTracks.position })
          .from(projectTracks)
          .where(eq(projectTracks.projectId, lockedScope.projectId))
          .orderBy(desc(projectTracks.position))
          .limit(1);
        return (last?.position ?? -1) + 1;
      },
      insertSongSpace: async (songSpace) => {
        const [row] = await tx
          .insert(projectTracks)
          .values({
            id: songSpace.id,
            projectId: songSpace.projectId,
            purchaseId: songSpace.purchaseId,
            title: songSpace.title,
            ...(songSpace.artist ? { artist: songSpace.artist } : {}),
            position: songSpace.position,
          })
          .returning();
        if (!row) {
          throw new SongSpaceDomainError("INTEGRITY_ERROR", "Song-space insert returned no row");
        }
        return {
          id: row.id,
          producerId: songSpace.producerId,
          projectId: row.projectId,
          purchaseId: row.purchaseId,
          title: row.title,
          artist: row.artist,
          position: row.position,
        };
      },
      touchProject: async (lockedScope, changedAt) => {
        await tx
          .update(projects)
          .set({ updatedAt: changedAt })
          .where(
            and(
              eq(projects.id, lockedScope.projectId),
              eq(projects.producerId, lockedScope.producerId),
            ),
          );
      },
    });
  });
}

/**
 * PostgreSQL adapter for project song-space reads and purchase-owned capacity
 * allocation.
 */
export function songSpaceRepository(db: Db): SongSpaceRepository {
  return {
    atomically: (scope, work) => runPurchaseOwnedAllocation(db, scope, work),
    loadProjectSongSpaces: (scope) =>
      db.transaction(
        async (tx): Promise<SongSpaceProjectSnapshot | null> => {
          const [project] = await tx
            .select({ id: projects.id, producerId: projects.producerId })
            .from(projects)
            .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)))
            .limit(1);
          if (!project) return null;

          const purchaseRows = await tx
            .select({
              purchaseId: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              lifecycleStatus: purchases.lifecycleStatus,
              commercialSnapshot: purchases.commercialSnapshot,
              acceptedAt: purchases.acceptedAt,
            })
            .from(purchases)
            .where(
              and(
                eq(purchases.producerId, scope.producerId),
                eq(purchases.projectId, scope.projectId),
              ),
            )
            .orderBy(asc(purchases.acceptedAt), asc(purchases.id));

          const trackRows = await tx
            .select({
              id: projectTracks.id,
              projectId: projectTracks.projectId,
              purchaseId: projectTracks.purchaseId,
              title: projectTracks.title,
              artist: projectTracks.artist,
              position: projectTracks.position,
            })
            .from(projectTracks)
            .where(eq(projectTracks.projectId, scope.projectId))
            .orderBy(asc(projectTracks.position), asc(projectTracks.id));

          return {
            producerId: project.producerId,
            projectId: project.id,
            purchases: purchaseRows.map((purchase) => ({
              producerId: purchase.producerId,
              projectId: purchase.projectId,
              purchaseId: purchase.purchaseId,
              lifecycleStatus: purchase.lifecycleStatus,
              includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
              acceptedAt: purchase.acceptedAt,
            })),
            tracks: trackRows.map((track) => ({
              ...track,
              producerId: project.producerId,
            })),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  };
}
