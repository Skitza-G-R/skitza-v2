import {
  and,
  clientContacts,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  projects,
  purchaseCancellations,
  purchaseInstallments,
  purchases,
  purchaseSessionAllowances,
  sql,
  type Db,
} from "@skitza/db";

import { clientAdvisoryLockKey } from "../client-management/lock";
import { projectAdvisoryLockKey } from "./lock";
import {
  ProjectLifecycleDomainError,
  type ProjectLifecycleClientRecord,
  type ProjectLifecycleProjectRecord,
  type ProjectLifecyclePurchaseRecord,
  type ProjectLifecycleRepository,
} from "./service";

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function purchaseLockKey(purchaseId: string): string {
  const normalized = purchaseId.trim();
  if (!normalized) throw new Error("Purchase id must not be empty");
  return normalized;
}

export function projectLifecycleRepository(db: Db): ProjectLifecycleRepository {
  // Keep table access lazy. A number of focused router tests use deliberately
  // partial @skitza/db mocks and never invoke lifecycle commands; evaluating
  // these selections at module import time would make those unrelated tests
  // depend on the lifecycle repository's full schema surface.
  const projectSelection = {
    id: projects.id,
    producerId: projects.producerId,
    clientContactId: projects.clientContactId,
    title: projects.title,
    deadlineAt: projects.deadlineAt,
    workflowStage: projects.workflowStage,
    lifecycleStatus: projects.lifecycleStatus,
    lifecycleChangedAt: projects.lifecycleChangedAt,
    updatedAt: projects.updatedAt,
  };
  const purchaseSelection = {
    id: purchases.id,
    producerId: purchases.producerId,
    projectId: purchases.projectId,
    lifecycleStatus: purchases.lifecycleStatus,
    canceledAt: purchases.canceledAt,
    updatedAt: purchases.updatedAt,
  };
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        // Reopening is the only project transition that can make client
        // archival invalid. Discover the immutable client owner, then use the
        // same client -> project advisory-lock order as client archival and
        // stable project ownership. No writer takes these locks in reverse.
        let discoveredReopenClientId: string | null = null;
        if (scope.kind === "reopen") {
          const [discoveredProject] = await tx
            .select({ clientContactId: projects.clientContactId })
            .from(projects)
            .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)))
            .limit(1);
          discoveredReopenClientId = discoveredProject?.clientContactId ?? null;
          if (discoveredReopenClientId !== null) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${clientAdvisoryLockKey(discoveredReopenClientId)}, 0))`,
            );
          }
        }

        // This is the established lock order used by version uploads and song
        // creation: project advisory lock, then purchase advisory locks. The
        // graph path takes purchase row locks before the project row because a
        // payment may already hold its purchase row while activating a project.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(scope.projectId)}, 0))`,
        );

        let reopenClient: ProjectLifecycleClientRecord | null = null;
        if (discoveredReopenClientId !== null) {
          const [lockedClient] = await tx
            .select({
              id: clientContacts.id,
              producerId: clientContacts.producerId,
              producerArchivedAt: clientContacts.producerArchivedAt,
            })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.id, discoveredReopenClientId),
                eq(clientContacts.producerId, scope.producerId),
              ),
            )
            .limit(1)
            .for("update");
          reopenClient = (lockedClient as ProjectLifecycleClientRecord | undefined) ?? null;
        }

        const discoverPurchaseIds = async (): Promise<string[]> => {
          const rows = await tx
            .select({ id: purchases.id })
            .from(purchases)
            .where(
              and(
                eq(purchases.producerId, scope.producerId),
                eq(purchases.projectId, scope.projectId),
              ),
            );
          return rows.map((row) => row.id).sort((left, right) => left.localeCompare(right));
        };

        let lockedPurchases: ProjectLifecyclePurchaseRecord[] = [];
        let initialGraphPurchaseIds: string[] | null = null;

        if (scope.kind === "graph") {
          initialGraphPurchaseIds = await discoverPurchaseIds();
          for (const purchaseId of initialGraphPurchaseIds) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLockKey(purchaseId)}, 0))`,
            );
          }
          for (const purchaseId of initialGraphPurchaseIds) {
            const [purchase] = await tx
              .select(purchaseSelection)
              .from(purchases)
              .where(
                and(
                  eq(purchases.id, purchaseId),
                  eq(purchases.producerId, scope.producerId),
                  eq(purchases.projectId, scope.projectId),
                ),
              )
              .limit(1)
              .for("update");
            if (!purchase) {
              throw new ProjectLifecycleDomainError(
                "CONCURRENT_CHANGE",
                "The project purchase graph changed while it was being locked",
              );
            }
            lockedPurchases.push(purchase);
          }
        } else if (scope.kind === "purchase") {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLockKey(scope.purchaseId)}, 0))`,
          );
          const [purchase] = await tx
            .select(purchaseSelection)
            .from(purchases)
            .where(
              and(
                eq(purchases.id, scope.purchaseId),
                eq(purchases.producerId, scope.producerId),
                eq(purchases.projectId, scope.projectId),
              ),
            )
            .limit(1)
            .for("update");
          if (purchase) lockedPurchases = [purchase];
        }

        const [lockedProject] = await tx
          .select(projectSelection)
          .from(projects)
          .where(and(eq(projects.id, scope.projectId), eq(projects.producerId, scope.producerId)))
          .limit(1)
          .for("update");

        if (
          scope.kind === "reopen" &&
          lockedProject &&
          lockedProject.clientContactId !== discoveredReopenClientId
        ) {
          throw new ProjectLifecycleDomainError(
            "CONCURRENT_CHANGE",
            "The stable project owner changed while the project was reopening",
          );
        }

        if (initialGraphPurchaseIds !== null) {
          // A purchase acceptance locks the project row before inserting. If it
          // won between discovery and this row lock, fail the whole transaction
          // and let the caller retry rather than mutating an incomplete graph.
          const finalPurchaseIds = await discoverPurchaseIds();
          if (!sameIds(initialGraphPurchaseIds, finalPurchaseIds)) {
            throw new ProjectLifecycleDomainError(
              "CONCURRENT_CHANGE",
              "A purchase was added to the project while its lifecycle was changing",
            );
          }
        }

        const project = (lockedProject as ProjectLifecycleProjectRecord | undefined) ?? null;
        return work({
          project,
          reopenClient,
          purchases: lockedPurchases,
          updateProjectMetadata: async (input) => {
            const [updated] = await tx
              .update(projects)
              .set({ ...input.patch, updatedAt: input.changedAt })
              .where(
                and(eq(projects.id, input.projectId), eq(projects.producerId, input.producerId)),
              )
              .returning(projectSelection);
            return (updated as ProjectLifecycleProjectRecord | undefined) ?? null;
          },
          transitionProject: async (input) => {
            const [updated] = await tx
              .update(projects)
              .set({
                lifecycleStatus: input.to,
                lifecycleChangedAt: input.changedAt,
                updatedAt: input.changedAt,
              })
              .where(
                and(
                  eq(projects.id, input.projectId),
                  eq(projects.producerId, input.producerId),
                  eq(projects.lifecycleStatus, input.from),
                ),
              )
              .returning(projectSelection);
            return (updated as ProjectLifecycleProjectRecord | undefined) ?? null;
          },
          cancelPurchase: async (input) => {
            const [updated] = await tx
              .update(purchases)
              .set({
                lifecycleStatus: "canceled",
                canceledAt: input.canceledAt,
                updatedAt: input.canceledAt,
              })
              .where(
                and(
                  eq(purchases.id, input.purchaseId),
                  eq(purchases.producerId, input.producerId),
                  eq(purchases.projectId, input.projectId),
                  eq(purchases.lifecycleStatus, input.from),
                  isNull(purchases.canceledAt),
                ),
              )
              .returning(purchaseSelection);
            return (updated as ProjectLifecyclePurchaseRecord | undefined) ?? null;
          },
          cancelFutureInstallments: async (input) => {
            const rows = await tx
              .update(purchaseInstallments)
              .set({
                status: "canceled",
                remindersEnabled: false,
                updatedAt: input.canceledAt,
              })
              .where(
                and(
                  eq(purchaseInstallments.purchaseId, input.purchaseId),
                  eq(purchaseInstallments.producerId, input.producerId),
                  eq(purchaseInstallments.status, "not_paid"),
                  eq(purchaseInstallments.requiredForActivation, false),
                  ne(purchaseInstallments.dueTrigger, "acceptance"),
                  or(
                    gt(purchaseInstallments.dueAt, input.canceledAt),
                    and(
                      isNull(purchaseInstallments.dueAt),
                      isNull(purchaseInstallments.triggeredAt),
                    ),
                  ),
                ),
              )
              .returning({ id: purchaseInstallments.id });
            return rows.length;
          },
          closeOpenAllowances: async (input) => {
            if (input.purchaseIds.length === 0) return 0;
            const rows = await tx
              .update(purchaseSessionAllowances)
              .set({ closedAt: input.closedAt, closeReason: input.reason })
              .where(
                and(
                  eq(purchaseSessionAllowances.producerId, input.producerId),
                  inArray(purchaseSessionAllowances.purchaseId, [...input.purchaseIds]),
                  isNull(purchaseSessionAllowances.closedAt),
                ),
              )
              .returning({ id: purchaseSessionAllowances.id });
            return rows.length;
          },
          insertPurchaseCancellation: async (input) => {
            const rows = await tx
              .insert(purchaseCancellations)
              .values({
                purchaseId: input.purchaseId,
                producerId: input.producerId,
                reason: input.reason,
                canceledByClerkUserId: input.actorId,
                canceledAt: input.canceledAt,
              })
              .onConflictDoNothing({ target: purchaseCancellations.purchaseId })
              .returning({ id: purchaseCancellations.id });
            return rows.length === 1;
          },
        });
      }),
  };
}
