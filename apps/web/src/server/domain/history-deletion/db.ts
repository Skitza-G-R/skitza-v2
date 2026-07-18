import {
  and,
  bookings,
  clientContacts,
  eq,
  notifications,
  paymentProofs,
  privateOffers,
  projectTracks,
  projects,
  purchaseAcceptances,
  purchaseRequests,
  purchases,
  sql,
  versionApprovalEvents,
  type Db,
} from "@skitza/db";

import type { HistoricalDeletionRepository } from "./service";

export function historicalDeletionRepository(db: Db): HistoricalDeletionRepository {
  return {
    atomically: (lockScope, work) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${lockScope.kind}:${lockScope.id}`}, 0))`,
        );

        return work({
          lockClient: async (scope) => {
            const [client] = await tx
              .select({
                id: clientContacts.id,
                producerId: clientContacts.producerId,
                clerkUserId: clientContacts.clerkUserId,
                invitedAt: clientContacts.invitedAt,
                artistArchivedAt: clientContacts.archivedAt,
                producerArchivedAt: clientContacts.producerArchivedAt,
              })
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.id, scope.clientId),
                  eq(clientContacts.producerId, scope.producerId),
                ),
              )
              .limit(1)
              .for("update");
            return client ?? null;
          },
          lockProject: async (scope) => {
            const [project] = await tx
              .select({
                id: projects.id,
                producerId: projects.producerId,
                lifecycleStatus: projects.lifecycleStatus,
              })
              .from(projects)
              .where(
                and(
                  eq(projects.id, scope.projectId),
                  eq(projects.producerId, scope.producerId),
                ),
              )
              .limit(1)
              .for("update");
            return project ?? null;
          },
          clientHasHistory: async (scope) => {
            const [row] = await tx
              .select({
                present: sql<boolean>`
                exists(select 1 from ${projects}
                  where ${projects.producerId} = ${scope.producerId}
                    and ${projects.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${purchaseRequests}
                  where ${purchaseRequests.producerId} = ${scope.producerId}
                    and ${purchaseRequests.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${privateOffers}
                  where ${privateOffers.producerId} = ${scope.producerId}
                    and ${privateOffers.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${purchases}
                  where ${purchases.producerId} = ${scope.producerId}
                    and ${purchases.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${purchaseAcceptances}
                  where ${purchaseAcceptances.producerId} = ${scope.producerId}
                    and ${purchaseAcceptances.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${paymentProofs}
                  where ${paymentProofs.producerId} = ${scope.producerId}
                    and ${paymentProofs.clientContactId} = ${scope.clientId})
                or exists(select 1 from ${versionApprovalEvents}
                  where ${versionApprovalEvents.producerId} = ${scope.producerId}
                    and ${versionApprovalEvents.clientContactId} = ${scope.clientId})
                `,
              })
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.id, scope.clientId),
                  eq(clientContacts.producerId, scope.producerId),
                ),
              )
              .limit(1);
            return row?.present === true;
          },
          projectHasHistory: async (scope) => {
            const [row] = await tx
              .select({
                present: sql<boolean>`
                exists(select 1 from ${projectTracks}
                  where ${projectTracks.projectId} = ${scope.projectId})
                or exists(select 1 from ${purchases}
                  where ${purchases.producerId} = ${scope.producerId}
                    and ${purchases.projectId} = ${scope.projectId})
                or exists(select 1 from ${purchaseRequests}
                  where ${purchaseRequests.producerId} = ${scope.producerId}
                    and ${purchaseRequests.projectId} = ${scope.projectId})
                or exists(select 1 from ${privateOffers}
                  where ${privateOffers.producerId} = ${scope.producerId}
                    and ${privateOffers.targetProjectId} = ${scope.projectId})
                or exists(select 1 from ${bookings}
                  where ${bookings.producerId} = ${scope.producerId}
                    and ${bookings.projectId} = ${scope.projectId})
                or exists(select 1 from ${notifications}
                  where ${notifications.producerId} = ${scope.producerId}
                    and ${notifications.projectId} = ${scope.projectId})
                `,
              })
              .from(projects)
              .where(
                and(
                  eq(projects.id, scope.projectId),
                  eq(projects.producerId, scope.producerId),
                ),
              )
              .limit(1);
            return row?.present === true;
          },
          deleteClient: async (scope) => {
            const rows = await tx
              .delete(clientContacts)
              .where(
                and(
                  eq(clientContacts.id, scope.clientId),
                  eq(clientContacts.producerId, scope.producerId),
                ),
              )
              .returning({ id: clientContacts.id });
            return rows.length === 1;
          },
          deleteProject: async (scope) => {
            const rows = await tx
              .delete(projects)
              .where(
                and(
                  eq(projects.id, scope.projectId),
                  eq(projects.producerId, scope.producerId),
                ),
              )
              .returning({ id: projects.id });
            return rows.length === 1;
          },
        });
      }),
  };
}
