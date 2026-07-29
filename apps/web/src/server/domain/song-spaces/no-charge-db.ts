import {
  and,
  asc,
  clientContacts,
  desc,
  eq,
  isNotNull,
  isNull,
  products,
  producers,
  projectTracks,
  projects,
  purchases,
  sql,
  type Db,
} from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import { purchaseRepositoryForTransaction } from "../purchases/db";
import { type NoChargeProposalContext, type NoChargeProposalRepository } from "./no-charge";
import { SongSpaceDomainError, type NewSongSpaceRecord } from "./service";
import type { NoChargeProposalPayload } from "./no-charge-token";

type ReadDb = Pick<Db, "select">;

function isCanonicalClerkUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

async function artistHasProducerIdentity(
  db: ReadDb,
  artistClerkUserId: unknown,
): Promise<boolean> {
  // Malformed contact identity is treated as producer/unsafe so every caller
  // fails closed even if an alternate auth adapter passes a trimmed value.
  if (!isCanonicalClerkUserId(artistClerkUserId)) return true;
  const [producerIdentity] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, artistClerkUserId))
    .limit(1);
  return producerIdentity !== undefined;
}

function includedSongSpaceCapacity(snapshot: unknown): number | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const capacity = (snapshot as Record<string, unknown>).includedSongSpaces;
  return Number.isSafeInteger(capacity) && (capacity as number) >= 0
    ? (capacity as number)
    : null;
}

async function activeSongSpaceCapacityExhausted(
  db: ReadDb,
  input: { producerId: string; projectId: string; clientContactId: string },
): Promise<boolean> {
  const activePurchases = await db
    .select({
      purchaseId: purchases.id,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.producerId, input.producerId),
        eq(purchases.projectId, input.projectId),
        eq(purchases.clientContactId, input.clientContactId),
        eq(purchases.lifecycleStatus, "active"),
      ),
    );
  if (activePurchases.length === 0) return false;

  const allocatedTracks = await db
    .select({ purchaseId: projectTracks.purchaseId })
    .from(projectTracks)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, projectTracks.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
      ),
    )
    .where(
      and(
        eq(projectTracks.projectId, input.projectId),
        eq(purchases.producerId, input.producerId),
        eq(purchases.clientContactId, input.clientContactId),
        eq(purchases.lifecycleStatus, "active"),
      ),
    );
  const allocatedByPurchase = new Map<string, number>();
  for (const track of allocatedTracks) {
    allocatedByPurchase.set(
      track.purchaseId,
      (allocatedByPurchase.get(track.purchaseId) ?? 0) + 1,
    );
  }

  return activePurchases.every((purchase) => {
    const capacity = includedSongSpaceCapacity(purchase.commercialSnapshot);
    return capacity !== null && (allocatedByPurchase.get(purchase.purchaseId) ?? 0) === capacity;
  });
}

async function loadProjectContext(
  db: ReadDb,
  input: {
    producerId: string;
    projectId: string;
    clientContactId?: string;
    clerkUserId?: string;
  },
) {
  const predicates = [
    eq(projects.id, input.projectId),
    eq(projects.producerId, input.producerId),
    eq(projects.lifecycleStatus, "active"),
    isNull(clientContacts.archivedAt),
  ];
  if (input.clientContactId) {
    predicates.push(eq(projects.clientContactId, input.clientContactId));
  }
  if (input.clerkUserId) {
    predicates.push(eq(clientContacts.clerkUserId, input.clerkUserId));
  }
  const [row] = await db
    .select({
      producerId: projects.producerId,
      producerName: producers.displayName,
      projectId: projects.id,
      projectTitle: projects.title,
      projectLifecycleStatus: projects.lifecycleStatus,
      clientContactId: projects.clientContactId,
      artistClerkUserId: clientContacts.clerkUserId,
    })
    .from(projects)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
      ),
    )
    .innerJoin(producers, eq(producers.id, projects.producerId))
    .where(and(...predicates))
    .limit(1);
  return row ?? null;
}

async function loadProductAnchor(
  db: ReadDb,
  input: {
    producerId: string;
    projectId: string;
    clientContactId: string;
    sourceProductId?: string;
  },
) {
  const predicates = [
    eq(purchases.producerId, input.producerId),
    eq(purchases.projectId, input.projectId),
    eq(purchases.clientContactId, input.clientContactId),
    eq(purchases.lifecycleStatus, "active"),
    isNotNull(purchases.productId),
    eq(purchases.currency, "ILS"),
  ];
  if (input.sourceProductId) {
    predicates.push(eq(products.id, input.sourceProductId));
  }
  const [row] = await db
    .select({
      sourceProductId: products.id,
      sourceProductName: products.name,
      sourceCurrency: purchases.currency,
    })
    .from(purchases)
    .innerJoin(
      products,
      and(eq(products.id, purchases.productId), eq(products.producerId, purchases.producerId)),
    )
    .where(and(...predicates))
    .orderBy(asc(purchases.acceptedAt), asc(purchases.id))
    .limit(1);
  return row ?? null;
}

async function loadContext(
  db: ReadDb,
  input: {
    producerId: string;
    projectId: string;
    clientContactId?: string;
    sourceProductId?: string;
    clerkUserId?: string;
  },
): Promise<NoChargeProposalContext | null> {
  const project = await loadProjectContext(db, input);
  if (!project) return null;
  const [anchor, producerIdentity, capacityExhausted] = await Promise.all([
    loadProductAnchor(db, {
      producerId: project.producerId,
      projectId: project.projectId,
      clientContactId: project.clientContactId,
      ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
    }),
    artistHasProducerIdentity(db, project.artistClerkUserId),
    activeSongSpaceCapacityExhausted(db, {
      producerId: project.producerId,
      projectId: project.projectId,
      clientContactId: project.clientContactId,
    }),
  ]);
  return anchor
    ? {
        ...project,
        ...anchor,
        artistHasProducerIdentity: producerIdentity,
        activeSongSpaceCapacityExhausted: capacityExhausted,
      }
    : null;
}

/**
 * Stateless proposal adapter. No pending commercial row is written. Preview
 * and acceptance resolve the token's exact active project, artist contact,
 * prior project purchase and product again; acceptance then commits the
 * canonical Purchase plus one track in one transaction.
 */
export function noChargeProposalRepository(db: Db): NoChargeProposalRepository {
  return {
    loadForProducer: (producerId, projectId) =>
      db.transaction((tx) => loadContext(tx, { producerId, projectId }), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }),

    loadForArtist: (payload, clerkUserId) =>
      db.transaction(
        (tx) =>
          loadContext(tx, {
            producerId: payload.producerId,
            projectId: payload.projectId,
            clientContactId: payload.clientContactId,
            sourceProductId: payload.sourceProductId,
            clerkUserId,
          }),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),

    acceptAtomically: (payload: NoChargeProposalPayload, work) =>
      db.transaction(async (tx) => {
        // Match regular song-space allocation's project advisory lock before
        // taking a project row lock or selecting the next position.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(payload.projectId)}, 0))`,
        );
        return work({
          purchaseRepository: purchaseRepositoryForTransaction(tx),
          loadForArtistForUpdate: async (lockedPayload, clerkUserId) => {
            const [project] = await tx
              .select({
                producerId: projects.producerId,
                producerName: producers.displayName,
                projectId: projects.id,
                projectTitle: projects.title,
                projectLifecycleStatus: projects.lifecycleStatus,
                clientContactId: projects.clientContactId,
                artistClerkUserId: clientContacts.clerkUserId,
              })
              .from(projects)
              .innerJoin(
                clientContacts,
                and(
                  eq(clientContacts.id, projects.clientContactId),
                  eq(clientContacts.producerId, projects.producerId),
                  eq(clientContacts.clerkUserId, clerkUserId),
                  isNull(clientContacts.archivedAt),
                ),
              )
              .innerJoin(producers, eq(producers.id, projects.producerId))
              .where(
                and(
                  eq(projects.id, lockedPayload.projectId),
                  eq(projects.producerId, lockedPayload.producerId),
                  eq(projects.clientContactId, lockedPayload.clientContactId),
                  eq(projects.lifecycleStatus, "active"),
                ),
              )
              .limit(1)
              .for("update");
            if (!project) return null;
            const producerIdentity = await artistHasProducerIdentity(
              tx,
              project.artistClerkUserId,
            );
            const [anchor] = await tx
              .select({
                sourceProductId: products.id,
                sourceProductName: products.name,
                sourceCurrency: purchases.currency,
              })
              .from(purchases)
              .innerJoin(
                products,
                and(
                  eq(products.id, purchases.productId),
                  eq(products.producerId, purchases.producerId),
                ),
              )
              .where(
                and(
                  eq(purchases.producerId, lockedPayload.producerId),
                  eq(purchases.projectId, lockedPayload.projectId),
                  eq(purchases.clientContactId, lockedPayload.clientContactId),
                  eq(purchases.lifecycleStatus, "active"),
                  eq(products.id, lockedPayload.sourceProductId),
                  eq(purchases.currency, "ILS"),
                ),
              )
              .orderBy(asc(purchases.acceptedAt), asc(purchases.id))
              .limit(1)
              .for("share");
            if (!anchor) return null;
            const capacityExhausted = await activeSongSpaceCapacityExhausted(tx, {
              producerId: project.producerId,
              projectId: project.projectId,
              clientContactId: project.clientContactId,
            });
            return {
              ...project,
              ...anchor,
              artistHasProducerIdentity: producerIdentity,
              activeSongSpaceCapacityExhausted: capacityExhausted,
            };
          },
          hasPurchaseForOperation: async (producerId, clientContactId, operationKey) => {
            const [purchase] = await tx
              .select({ id: purchases.id })
              .from(purchases)
              .where(
                and(
                  eq(purchases.producerId, producerId),
                  eq(purchases.clientContactId, clientContactId),
                  eq(purchases.operationKey, operationKey),
                ),
              )
              .limit(1)
              .for("update");
            return purchase !== undefined;
          },
          findSongSpaceForPurchase: async (purchaseId) => {
            const rows = await tx
              .select({
                id: projectTracks.id,
                projectId: projectTracks.projectId,
                purchaseId: projectTracks.purchaseId,
                title: projectTracks.title,
                artist: projectTracks.artist,
                position: projectTracks.position,
              })
              .from(projectTracks)
              .where(
                and(
                  eq(projectTracks.projectId, payload.projectId),
                  eq(projectTracks.purchaseId, purchaseId),
                ),
              )
              .orderBy(asc(projectTracks.position), asc(projectTracks.id))
              .limit(2);
            if (rows.length > 1) {
              throw new SongSpaceDomainError(
                "INTEGRITY_ERROR",
                "No-charge purchase owns more than one song space",
              );
            }
            const row = rows[0];
            return row ? { ...row, producerId: payload.producerId } : null;
          },
          nextProjectPosition: async (projectId) => {
            const [last] = await tx
              .select({ position: projectTracks.position })
              .from(projectTracks)
              .where(eq(projectTracks.projectId, projectId))
              .orderBy(desc(projectTracks.position))
              .limit(1);
            return (last?.position ?? -1) + 1;
          },
          insertSongSpace: async (songSpace: NewSongSpaceRecord) => {
            const [row] = await tx
              .insert(projectTracks)
              .values({
                projectId: songSpace.projectId,
                purchaseId: songSpace.purchaseId,
                title: songSpace.title,
                ...(songSpace.artist ? { artist: songSpace.artist } : {}),
                position: songSpace.position,
              })
              .returning();
            if (!row) {
              throw new SongSpaceDomainError(
                "INTEGRITY_ERROR",
                "No-charge song-space insert returned no row",
              );
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
          touchProject: async (producerId, projectId, changedAt) => {
            const [row] = await tx
              .update(projects)
              .set({ updatedAt: changedAt })
              .where(and(eq(projects.id, projectId), eq(projects.producerId, producerId)))
              .returning({ id: projects.id });
            if (!row) {
              throw new SongSpaceDomainError("NOT_FOUND", "No-charge project was not found");
            }
          },
        });
      }),
  };
}
