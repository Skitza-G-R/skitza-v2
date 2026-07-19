import {
  and,
  asc,
  eq,
  inArray,
  projects,
  purchaseRequests,
  purchases,
  type Db,
} from "@skitza/db";

import {
  assertPurchaseTargetCanChange,
  PurchaseTargetingError,
  type PurchaseTargetingStatus,
} from "./service";

export type PurchaseTargetProjectContext = {
  id: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active";
  workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
  updatedAt: Date;
};

export async function listSameClientPurchaseTargets(
  db: Pick<Db, "select">,
  scope: { producerId: string; clientContactId: string },
): Promise<PurchaseTargetProjectContext[]> {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      lifecycleStatus: projects.lifecycleStatus,
      workflowStage: projects.workflowStage,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.producerId, scope.producerId),
        eq(projects.clientContactId, scope.clientContactId),
        inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .orderBy(asc(projects.title), asc(projects.createdAt)) as Promise<
    PurchaseTargetProjectContext[]
  >;
}

export async function correctProducerPurchaseTarget(
  db: Db,
  input: { producerId: string; purchaseRequestId: string; projectId: string | null },
): Promise<{ projectId: string | null }> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        id: purchaseRequests.id,
        producerId: purchaseRequests.producerId,
        clientContactId: purchaseRequests.clientContactId,
        status: purchaseRequests.status,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, input.purchaseRequestId),
          eq(purchaseRequests.producerId, input.producerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!request) {
      throw new PurchaseTargetingError("NOT_FOUND", "Purchase request or target was not found.");
    }

    const [accepted] = await tx
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.purchaseRequestId, request.id))
      .limit(1);
    assertPurchaseTargetCanChange({
      status: request.status as PurchaseTargetingStatus,
      hasAcceptedPurchase: accepted !== undefined,
    });

    let targetProjectId: string | null = null;
    if (input.projectId !== null) {
      const [target] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, request.producerId),
            eq(projects.clientContactId, request.clientContactId),
            inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
          ),
        )
        .limit(1)
        .for("share");
      if (!target) {
        throw new PurchaseTargetingError("NOT_FOUND", "Purchase request or target was not found.");
      }
      targetProjectId = target.id;
    }

    const [updated] = await tx
      .update(purchaseRequests)
      .set({ projectId: targetProjectId, updatedAt: new Date() })
      .where(
        and(
          eq(purchaseRequests.id, request.id),
          eq(purchaseRequests.producerId, request.producerId),
          eq(purchaseRequests.clientContactId, request.clientContactId),
          eq(purchaseRequests.status, request.status),
        ),
      )
      .returning({ projectId: purchaseRequests.projectId });
    if (!updated) {
      throw new PurchaseTargetingError(
        "LOCKED",
        "This purchase target changed in another tab. Refresh and try again.",
      );
    }
    return { projectId: updated.projectId };
  });
}
