import {
  and,
  asc,
  clientContacts,
  desc,
  eq,
  isNotNull,
  isNull,
  projectTracks,
  projects,
  purchaseInstallments,
  purchases,
  sql,
  trackVersions,
  versionApprovalEvents,
  type Db,
} from "@skitza/db";

import type {
  VersionApprovalAtomicScope,
  VersionApprovalEventRecord,
  VersionApprovalGraph,
  VersionApprovalRepository,
  VersionApprovalTransaction,
  VersionApprovalVersionRecord,
} from "./service";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

type ApprovalDiscovery = {
  projectId: string;
  purchaseId: string;
  trackId: string;
};

async function discoverScope(
  tx: TransactionDb,
  scope: VersionApprovalAtomicScope,
): Promise<ApprovalDiscovery | null> {
  if (scope.kind === "producer_reopen") {
    const [row] = await tx
      .select({
        projectId: projectTracks.projectId,
        purchaseId: projectTracks.purchaseId,
        trackId: projectTracks.id,
      })
      .from(projectTracks)
      .innerJoin(
        projects,
        and(eq(projects.id, projectTracks.projectId), eq(projects.producerId, scope.producerId)),
      )
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, projectTracks.purchaseId),
          eq(purchases.projectId, projectTracks.projectId),
          eq(purchases.producerId, scope.producerId),
          eq(purchases.clientContactId, projects.clientContactId),
        ),
      )
      .where(
        and(eq(projectTracks.id, scope.trackId), eq(projects.producerId, scope.producerId)),
      )
      .limit(1);
    return row ?? null;
  }

  const base = tx
    .select({
      projectId: projectTracks.projectId,
      purchaseId: trackVersions.purchaseId,
      trackId: trackVersions.trackId,
    })
    .from(trackVersions)
    .innerJoin(
      projectTracks,
      and(
        eq(projectTracks.id, trackVersions.trackId),
        eq(projectTracks.purchaseId, trackVersions.purchaseId),
      ),
    )
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, trackVersions.purchaseId),
        eq(purchases.projectId, projectTracks.projectId),
        eq(purchases.producerId, projects.producerId),
        eq(purchases.clientContactId, projects.clientContactId),
      ),
    );

  if (scope.kind === "producer_ready") {
    const [row] = await base
      .where(
        and(
          eq(trackVersions.id, scope.versionId),
          eq(trackVersions.producerId, scope.producerId),
          eq(projects.producerId, scope.producerId),
          eq(purchases.producerId, scope.producerId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await base
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, projects.clientContactId),
        eq(clientContacts.producerId, projects.producerId),
        eq(clientContacts.clerkUserId, scope.artistClerkUserId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .where(eq(trackVersions.id, scope.versionId))
    .limit(1);
  return row ?? null;
}

function unavailableTransaction(): VersionApprovalTransaction {
  return {
    graph: null,
    setProducerReadyVersion: () => Promise.resolve(null),
    appendApprovalEvent: () => Promise.resolve(null),
    triggerFinalInstallment: () => Promise.resolve(null),
  };
}

async function loadLockedGraph(
  tx: TransactionDb,
  discovery: ApprovalDiscovery,
): Promise<VersionApprovalGraph | null> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${discovery.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${discovery.purchaseId}, 0))`,
  );

  const [project] = await tx
    .select({
      id: projects.id,
      producerId: projects.producerId,
      clientContactId: projects.clientContactId,
      lifecycleStatus: projects.lifecycleStatus,
    })
    .from(projects)
    .where(eq(projects.id, discovery.projectId))
    .limit(1)
    .for("update");
  const [purchase] = await tx
    .select({
      id: purchases.id,
      projectId: purchases.projectId,
      producerId: purchases.producerId,
      clientContactId: purchases.clientContactId,
      lifecycleStatus: purchases.lifecycleStatus,
      paymentPlanKind: purchases.paymentPlanKind,
      commercialSnapshot: purchases.commercialSnapshot,
    })
    .from(purchases)
    .where(eq(purchases.id, discovery.purchaseId))
    .limit(1)
    .for("update");
  if (!project || !purchase) return null;

  const [contact] = await tx
    .select({
      clerkUserId: clientContacts.clerkUserId,
      artistArchivedAt: clientContacts.archivedAt,
    })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.id, project.clientContactId),
        eq(clientContacts.producerId, project.producerId),
      ),
    )
    .limit(1)
    .for("update");

  const tracks = await tx
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
      purchaseId: projectTracks.purchaseId,
      archivedAt: projectTracks.archivedAt,
    })
    .from(projectTracks)
    .where(
      and(
        eq(projectTracks.projectId, discovery.projectId),
        eq(projectTracks.purchaseId, discovery.purchaseId),
      ),
    )
    .orderBy(asc(projectTracks.id))
    .for("update");

  const versions = await tx
    .select({
      id: trackVersions.id,
      trackId: trackVersions.trackId,
      purchaseId: trackVersions.purchaseId,
      producerId: trackVersions.producerId,
      audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
      audioUrl: trackVersions.audioUrl,
      audioDeletedAt: trackVersions.audioDeletedAt,
      producerMarkedFinalAt: trackVersions.producerMarkedFinalAt,
    })
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.purchaseId, discovery.purchaseId),
        eq(trackVersions.producerId, project.producerId),
      ),
    )
    .orderBy(asc(trackVersions.trackId), asc(trackVersions.id))
    .for("update");

  const approvalEvents = await tx
    .select({
      id: versionApprovalEvents.id,
      versionId: versionApprovalEvents.versionId,
      trackId: trackVersions.trackId,
      purchaseId: versionApprovalEvents.purchaseId,
      producerId: versionApprovalEvents.producerId,
      clientContactId: versionApprovalEvents.clientContactId,
      audioIdentityFingerprint: versionApprovalEvents.audioIdentityFingerprint,
      action: versionApprovalEvents.action,
      actedByClerkUserId: versionApprovalEvents.actedByClerkUserId,
      createdAt: versionApprovalEvents.createdAt,
    })
    .from(versionApprovalEvents)
    .innerJoin(
      trackVersions,
      and(
        eq(trackVersions.id, versionApprovalEvents.versionId),
        eq(trackVersions.purchaseId, versionApprovalEvents.purchaseId),
      ),
    )
    .where(
      and(
        eq(versionApprovalEvents.purchaseId, discovery.purchaseId),
        eq(versionApprovalEvents.producerId, project.producerId),
        eq(versionApprovalEvents.clientContactId, project.clientContactId),
      ),
    )
    .orderBy(desc(versionApprovalEvents.createdAt), desc(versionApprovalEvents.id));

  const installments = await tx
    .select({
      id: purchaseInstallments.id,
      purchaseId: purchaseInstallments.purchaseId,
      producerId: purchaseInstallments.producerId,
      position: purchaseInstallments.position,
      dueTrigger: purchaseInstallments.dueTrigger,
      dueAt: purchaseInstallments.dueAt,
      triggeredAt: purchaseInstallments.triggeredAt,
      status: purchaseInstallments.status,
    })
    .from(purchaseInstallments)
    .where(
      and(
        eq(purchaseInstallments.purchaseId, discovery.purchaseId),
        eq(purchaseInstallments.producerId, project.producerId),
      ),
    )
    .orderBy(asc(purchaseInstallments.position))
    .for("update");

  return {
    project,
    purchase: {
      id: purchase.id,
      projectId: purchase.projectId,
      producerId: purchase.producerId,
      clientContactId: purchase.clientContactId,
      lifecycleStatus: purchase.lifecycleStatus,
      paymentPlanKind: purchase.paymentPlanKind,
      includedSongSpaces: purchase.commercialSnapshot.includedSongSpaces,
    },
    artistOwnerClerkUserId:
      contact?.artistArchivedAt === null ? contact.clerkUserId : null,
    tracks,
    versions,
    approvalEvents,
    installments,
  };
}

function transactionFor(
  tx: TransactionDb,
  graph: VersionApprovalGraph,
): VersionApprovalTransaction {
  return {
    graph,
    setProducerReadyVersion: async (input) => {
      await tx
        .update(trackVersions)
        .set({ producerMarkedFinalAt: null })
        .where(
          and(
            eq(trackVersions.trackId, input.trackId),
            eq(trackVersions.purchaseId, input.purchaseId),
            eq(trackVersions.producerId, input.producerId),
          ),
        );

      const [updated] = await tx
        .update(trackVersions)
        .set({ producerMarkedFinalAt: input.markedFinalAt })
        .where(
          and(
            eq(trackVersions.id, input.versionId),
            eq(trackVersions.trackId, input.trackId),
            eq(trackVersions.purchaseId, input.purchaseId),
            eq(trackVersions.producerId, input.producerId),
            ...(input.markedFinalAt === null
              ? []
              : [
                  isNotNull(trackVersions.audioUrl),
                  isNotNull(trackVersions.audioIdentityFingerprint),
                  isNull(trackVersions.audioDeletedAt),
                ]),
          ),
        )
        .returning({
          id: trackVersions.id,
          trackId: trackVersions.trackId,
          purchaseId: trackVersions.purchaseId,
          producerId: trackVersions.producerId,
          audioIdentityFingerprint: trackVersions.audioIdentityFingerprint,
          audioUrl: trackVersions.audioUrl,
          audioDeletedAt: trackVersions.audioDeletedAt,
          producerMarkedFinalAt: trackVersions.producerMarkedFinalAt,
        });
      if (!updated) return null;
      await tx
        .update(projects)
        .set({ updatedAt: input.changedAt })
        .where(and(eq(projects.id, input.projectId), eq(projects.producerId, input.producerId)));
      return updated satisfies VersionApprovalVersionRecord;
    },
    appendApprovalEvent: async (input) => {
      const [inserted] = await tx
        .insert(versionApprovalEvents)
        .values({
          versionId: input.versionId,
          purchaseId: input.purchaseId,
          producerId: input.producerId,
          clientContactId: input.clientContactId,
          audioIdentityFingerprint: input.audioIdentityFingerprint,
          action: input.action,
          actedByClerkUserId: input.actedByClerkUserId,
          createdAt: input.createdAt,
        })
        .returning({
          id: versionApprovalEvents.id,
          versionId: versionApprovalEvents.versionId,
          purchaseId: versionApprovalEvents.purchaseId,
          producerId: versionApprovalEvents.producerId,
          clientContactId: versionApprovalEvents.clientContactId,
          audioIdentityFingerprint: versionApprovalEvents.audioIdentityFingerprint,
          action: versionApprovalEvents.action,
          actedByClerkUserId: versionApprovalEvents.actedByClerkUserId,
          createdAt: versionApprovalEvents.createdAt,
        });
      if (!inserted) return null;
      await tx
        .update(projects)
        .set({ updatedAt: input.createdAt })
        .where(and(eq(projects.id, graph.project.id), eq(projects.producerId, input.producerId)));
      return { ...inserted, trackId: input.trackId } satisfies VersionApprovalEventRecord;
    },
    triggerFinalInstallment: async (input) => {
      const [updated] = await tx
        .update(purchaseInstallments)
        .set({
          dueAt: input.triggeredAt,
          triggeredAt: input.triggeredAt,
          updatedAt: input.triggeredAt,
        })
        .where(
          and(
            eq(purchaseInstallments.id, input.installmentId),
            eq(purchaseInstallments.purchaseId, input.purchaseId),
            eq(purchaseInstallments.producerId, input.producerId),
            eq(purchaseInstallments.position, 2),
            eq(purchaseInstallments.dueTrigger, "artist_approval"),
            eq(purchaseInstallments.status, "not_paid"),
            isNull(purchaseInstallments.dueAt),
            isNull(purchaseInstallments.triggeredAt),
          ),
        )
        .returning({
          id: purchaseInstallments.id,
          purchaseId: purchaseInstallments.purchaseId,
          producerId: purchaseInstallments.producerId,
          position: purchaseInstallments.position,
          dueTrigger: purchaseInstallments.dueTrigger,
          dueAt: purchaseInstallments.dueAt,
          triggeredAt: purchaseInstallments.triggeredAt,
          status: purchaseInstallments.status,
        });
      return updated ?? null;
    },
  };
}

export function versionApprovalRepository(db: Db): VersionApprovalRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        const discovery = await discoverScope(tx, scope);
        if (!discovery) return work(unavailableTransaction());
        const graph = await loadLockedGraph(tx, discovery);
        if (!graph) return work(unavailableTransaction());
        return work(transactionFor(tx, graph));
      }),
  };
}
