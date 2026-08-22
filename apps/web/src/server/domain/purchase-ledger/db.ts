import {
  and,
  asc,
  clientContacts,
  eq,
  inArray,
  isNull,
  paymentProofs,
  producers,
  projectPaymentPauseEvents,
  projects,
  purchaseCancellations,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchases,
  purchaseWaivers,
  sql,
  type Db,
} from "@skitza/db";

import { projectAdvisoryLockKey } from "../project-lifecycle/lock";
import { PurchaseLedgerDomainError } from "./policy";
import type {
  NewProjectPaymentPauseEvent,
  NewPurchaseCancellation,
  NewPurchaseCorrection,
  NewPurchasePayment,
  NewPurchaseWaiver,
  ProjectPaymentPauseEventRecord,
  PurchaseCancellationRecord,
  PurchaseLedgerCorrectionRecord,
  PurchaseLedgerPaymentRecord,
  PurchaseLedgerRepository,
  PurchaseLedgerSnapshot,
  PurchaseLedgerTransaction,
  PurchaseLedgerWaiverRecord,
} from "./service";

export type PurchaseLedgerTransactionDb = Pick<Db, "select" | "insert" | "update" | "execute">;

type LedgerScope = Readonly<{ producerId: string; purchaseId: string }>;

export function purchaseLedgerAdvisoryLockKey(purchaseId: string): string {
  return `purchase-ledger:${purchaseId}`;
}

async function discoverProjectId(db: PurchaseLedgerTransactionDb, scope: LedgerScope) {
  const [row] = await db
    .select({ projectId: purchases.projectId })
    .from(purchases)
    .where(and(eq(purchases.id, scope.purchaseId), eq(purchases.producerId, scope.producerId)))
    .limit(1);
  return row?.projectId ?? null;
}

/** Acquire the shared money lock order: project first, exact purchase second. */
export async function lockPurchaseLedgerScope(
  tx: PurchaseLedgerTransactionDb,
  scope: LedgerScope,
): Promise<string> {
  const projectId = await discoverProjectId(tx, scope);
  if (!projectId) throw new PurchaseLedgerDomainError("NOT_FOUND", "Purchase ledger was not found");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(projectId)}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${purchaseLedgerAdvisoryLockKey(scope.purchaseId)}, 0))`,
  );
  return projectId;
}

async function loadSnapshot(
  tx: PurchaseLedgerTransactionDb,
  scope: LedgerScope,
): Promise<PurchaseLedgerSnapshot | null> {
  const [context] = await tx
    .select({
      purchaseId: purchases.id,
      purchaseProducerId: purchases.producerId,
      projectId: purchases.projectId,
      clientContactId: purchases.clientContactId,
      currency: purchases.currency,
      totalCents: purchases.totalCents,
      plan: purchases.paymentPlanKind,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
      sourceKind: purchases.sourceKind,
      acceptedAt: purchases.acceptedAt,
      commercialEstablishedAt: purchases.commercialEstablishedAt,
      activatedAt: purchases.activatedAt,
      canceledAt: purchases.canceledAt,
      refNumber: purchases.refNumber,
      commercialSnapshot: purchases.commercialSnapshot,
      projectProducerId: projects.producerId,
      projectClientContactId: projects.clientContactId,
      projectLifecycleStatus: projects.lifecycleStatus,
      producerTimeZone: producers.timezone,
      automaticRemindersEnabled: producers.autopilotUnpaidReminder,
      producerDisplayName: producers.displayName,
      clientId: clientContacts.id,
      clientName: clientContacts.name,
      clientEmail: clientContacts.email,
    })
    .from(purchases)
    .innerJoin(
      projects,
      and(
        eq(projects.id, purchases.projectId),
        eq(projects.producerId, purchases.producerId),
        eq(projects.clientContactId, purchases.clientContactId),
      ),
    )
    .innerJoin(producers, eq(producers.id, purchases.producerId))
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, purchases.clientContactId),
        eq(clientContacts.producerId, purchases.producerId),
      ),
    )
    .where(and(eq(purchases.id, scope.purchaseId), eq(purchases.producerId, scope.producerId)))
    .limit(1)
    .for("update");
  if (!context) return null;

  const installments = await tx
    .select()
    .from(purchaseInstallments)
    .where(
      and(
        eq(purchaseInstallments.purchaseId, scope.purchaseId),
        eq(purchaseInstallments.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(purchaseInstallments.position));
  const payments = await tx
    .select()
    .from(purchasePayments)
    .where(
      and(
        eq(purchasePayments.purchaseId, scope.purchaseId),
        eq(purchasePayments.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(purchasePayments.paidAt), asc(purchasePayments.id));
  const corrections = await tx
    .select()
    .from(purchasePaymentCorrections)
    .where(
      and(
        eq(purchasePaymentCorrections.purchaseId, scope.purchaseId),
        eq(purchasePaymentCorrections.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(purchasePaymentCorrections.paymentId), asc(purchasePaymentCorrections.sequence));
  const waivers = await tx
    .select()
    .from(purchaseWaivers)
    .where(
      and(
        eq(purchaseWaivers.purchaseId, scope.purchaseId),
        eq(purchaseWaivers.producerId, scope.producerId),
      ),
    )
    .orderBy(asc(purchaseWaivers.createdAt), asc(purchaseWaivers.id));
  const pendingProofs = await tx
    .select({ installmentId: paymentProofs.installmentId })
    .from(paymentProofs)
    .where(
      and(
        eq(paymentProofs.purchaseId, scope.purchaseId),
        eq(paymentProofs.producerId, scope.producerId),
        eq(paymentProofs.status, "pending"),
      ),
    );
  const [cancellation] = await tx
    .select()
    .from(purchaseCancellations)
    .where(
      and(
        eq(purchaseCancellations.purchaseId, scope.purchaseId),
        eq(purchaseCancellations.producerId, scope.producerId),
      ),
    )
    .limit(1);
  const pauseEvents = await tx
    .select()
    .from(projectPaymentPauseEvents)
    .where(
      and(
        eq(projectPaymentPauseEvents.projectId, context.projectId),
        eq(projectPaymentPauseEvents.producerId, scope.producerId),
        eq(projectPaymentPauseEvents.purchaseId, scope.purchaseId),
      ),
    )
    .orderBy(asc(projectPaymentPauseEvents.changedAt), asc(projectPaymentPauseEvents.id));

  return {
    purchase: {
      id: context.purchaseId,
      producerId: context.purchaseProducerId,
      projectId: context.projectId,
      clientContactId: context.clientContactId,
      currency: context.currency,
      totalCents: context.totalCents,
      plan: context.plan,
      lifecycleStatus: context.purchaseLifecycleStatus,
      sourceKind: context.sourceKind,
      acceptedAt: context.acceptedAt,
      commercialEstablishedAt: context.commercialEstablishedAt,
      activatedAt: context.activatedAt,
      canceledAt: context.canceledAt,
    },
    project: {
      id: context.projectId,
      producerId: context.projectProducerId,
      clientContactId: context.projectClientContactId,
      lifecycleStatus: context.projectLifecycleStatus,
    },
    producer: {
      id: context.purchaseProducerId,
      timeZone: context.producerTimeZone,
      automaticRemindersEnabled: context.automaticRemindersEnabled,
      displayName: context.producerDisplayName ?? "Your producer",
    },
    client: { id: context.clientId, name: context.clientName, email: context.clientEmail },
    purchaseName: context.commercialSnapshot.productOrOfferName,
    refNumber: context.refNumber,
    installments: installments.map((installment) => ({
      id: installment.id,
      purchaseId: installment.purchaseId,
      producerId: installment.producerId,
      position: installment.position,
      amountCents: installment.amountCents,
      currency: installment.currency,
      dueAt: installment.dueAt,
      dueTrigger: installment.dueTrigger,
      triggeredAt: installment.triggeredAt,
      requiredForActivation: installment.requiredForActivation,
      status: installment.status,
      remindersEnabled: installment.remindersEnabled,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      purchaseId: payment.purchaseId,
      installmentId: payment.installmentId,
      producerId: payment.producerId,
      operationKey: payment.operationKey,
      operationDigest: payment.operationDigest,
      source: payment.source,
      proofId: payment.proofId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      paidAt: payment.paidAt,
      addedByClerkUserId: payment.addedByClerkUserId,
      note: payment.note,
    })),
    corrections: corrections.map((correction) => ({
      id: correction.id,
      purchaseId: correction.purchaseId,
      paymentId: correction.paymentId,
      producerId: correction.producerId,
      operationKey: correction.operationKey,
      operationDigest: correction.operationDigest,
      sequence: correction.sequence,
      previousAmountCents: correction.previousAmountCents,
      newAmountCents: correction.newAmountCents,
      reason: correction.reason,
      correctedByClerkUserId: correction.correctedByClerkUserId,
      createdAt: correction.createdAt,
    })),
    waivers: waivers.map((waiver) => ({
      id: waiver.id,
      purchaseId: waiver.purchaseId,
      installmentId: waiver.installmentId,
      producerId: waiver.producerId,
      operationKey: waiver.operationKey,
      operationDigest: waiver.operationDigest,
      amountCents: waiver.amountCents,
      reason: waiver.reason,
      waivedByClerkUserId: waiver.waivedByClerkUserId,
      createdAt: waiver.createdAt,
    })),
    pendingProofInstallmentIds: pendingProofs.map((proof) => proof.installmentId),
    cancellation: cancellation
      ? {
          id: cancellation.id,
          purchaseId: cancellation.purchaseId,
          producerId: cancellation.producerId,
          operationKey: cancellation.operationKey,
          operationDigest: cancellation.operationDigest,
          reason: cancellation.reason,
          canceledByClerkUserId: cancellation.canceledByClerkUserId,
          canceledAt: cancellation.canceledAt,
        }
      : null,
    pauseEvents: pauseEvents.map((event) => ({
      id: event.id,
      purchaseId: event.purchaseId,
      projectId: event.projectId,
      producerId: event.producerId,
      action: event.action,
      operationKey: event.operationKey,
      operationDigest: event.operationDigest,
      reason: event.reason,
      changedByClerkUserId: event.changedByClerkUserId,
      changedAt: event.changedAt,
    })),
  };
}

function transactionAdapter(
  tx: PurchaseLedgerTransactionDb,
  scope: LedgerScope,
): PurchaseLedgerTransaction {
  return {
    loadSnapshot: () => loadSnapshot(tx, scope),
    insertPayment: async (input: NewPurchasePayment) => {
      const [row] = await tx.insert(purchasePayments).values(input).returning();
      if (!row) throw new Error("Payment insert did not return a row");
      return row as PurchaseLedgerPaymentRecord;
    },
    insertCorrection: async (input: NewPurchaseCorrection) => {
      const [row] = await tx.insert(purchasePaymentCorrections).values(input).returning();
      if (!row) throw new Error("Correction insert did not return a row");
      return row as PurchaseLedgerCorrectionRecord;
    },
    insertWaiver: async (input: NewPurchaseWaiver) => {
      const [row] = await tx.insert(purchaseWaivers).values(input).returning();
      if (!row) throw new Error("Waiver insert did not return a row");
      return row as PurchaseLedgerWaiverRecord;
    },
    insertCancellation: async (input: NewPurchaseCancellation) => {
      const [row] = await tx.insert(purchaseCancellations).values(input).returning();
      if (!row) throw new Error("Cancellation insert did not return a row");
      return row as PurchaseCancellationRecord;
    },
    setMonthlyInstallmentDates: async (rows, changedAt) => {
      let changed = 0;
      for (const row of rows) {
        const updated = await tx
          .update(purchaseInstallments)
          .set({ dueAt: row.dueAt, triggeredAt: row.triggeredAt, updatedAt: changedAt })
          .where(
            and(
              eq(purchaseInstallments.id, row.installmentId),
              eq(purchaseInstallments.purchaseId, scope.purchaseId),
              eq(purchaseInstallments.producerId, scope.producerId),
              eq(purchaseInstallments.dueTrigger, "monthly_anniversary"),
              isNull(purchaseInstallments.dueAt),
              isNull(purchaseInstallments.triggeredAt),
            ),
          )
          .returning({ id: purchaseInstallments.id });
        changed += updated.length;
      }
      return changed;
    },
    setInstallmentStatuses: async (rows, changedAt) => {
      let changed = 0;
      for (const row of rows) {
        const updated = await tx
          .update(purchaseInstallments)
          .set({ status: row.status, updatedAt: changedAt })
          .where(
            and(
              eq(purchaseInstallments.id, row.installmentId),
              eq(purchaseInstallments.purchaseId, scope.purchaseId),
              eq(purchaseInstallments.producerId, scope.producerId),
            ),
          )
          .returning({ id: purchaseInstallments.id });
        changed += updated.length;
      }
      return changed;
    },
    activatePurchaseAndWaitingProject: async (activatedAt) => {
      const [activated] = await tx
        .update(purchases)
        .set({ lifecycleStatus: "active", activatedAt, updatedAt: activatedAt })
        .where(
          and(
            eq(purchases.id, scope.purchaseId),
            eq(purchases.producerId, scope.producerId),
            eq(purchases.lifecycleStatus, "waiting_for_payment"),
            isNull(purchases.activatedAt),
          ),
        )
        .returning({ projectId: purchases.projectId, clientContactId: purchases.clientContactId });
      if (!activated) {
        throw new PurchaseLedgerDomainError("CONFLICT", "Purchase activation changed concurrently");
      }
      await tx
        .update(projects)
        .set({ lifecycleStatus: "active", lifecycleChangedAt: activatedAt, updatedAt: activatedAt })
        .where(
          and(
            eq(projects.id, activated.projectId),
            eq(projects.producerId, scope.producerId),
            eq(projects.clientContactId, activated.clientContactId),
            eq(projects.lifecycleStatus, "waiting_for_payment"),
          ),
        );
    },
    setInstallmentRemindersEnabled: async (installmentId, enabled) => {
      const rows = await tx
        .update(purchaseInstallments)
        .set({ remindersEnabled: enabled, updatedAt: new Date() })
        .where(
          and(
            eq(purchaseInstallments.id, installmentId),
            eq(purchaseInstallments.purchaseId, scope.purchaseId),
            eq(purchaseInstallments.producerId, scope.producerId),
          ),
        )
        .returning({ id: purchaseInstallments.id });
      return rows.length === 1;
    },
    cancelFutureInstallments: async (installmentIds, canceledAt) => {
      if (installmentIds.length === 0) return 0;
      const rows = await tx
        .update(purchaseInstallments)
        .set({ status: "canceled", remindersEnabled: false, updatedAt: canceledAt })
        .where(
          and(
            eq(purchaseInstallments.purchaseId, scope.purchaseId),
            eq(purchaseInstallments.producerId, scope.producerId),
            inArray(purchaseInstallments.id, [...installmentIds]),
          ),
        )
        .returning({ id: purchaseInstallments.id });
      return rows.length;
    },
    cancelPurchase: async (canceledAt) => {
      const rows = await tx
        .update(purchases)
        .set({ lifecycleStatus: "canceled", canceledAt, updatedAt: canceledAt })
        .where(
          and(
            eq(purchases.id, scope.purchaseId),
            eq(purchases.producerId, scope.producerId),
            inArray(purchases.lifecycleStatus, ["waiting_for_payment", "active"]),
            isNull(purchases.canceledAt),
          ),
        )
        .returning({ id: purchases.id });
      return rows.length === 1;
    },
    transitionProject: async (from, to, changedAt) => {
      const snapshot = await loadSnapshot(tx, scope);
      if (!snapshot) return false;
      const rows = await tx
        .update(projects)
        .set({ lifecycleStatus: to, lifecycleChangedAt: changedAt, updatedAt: changedAt })
        .where(
          and(
            eq(projects.id, snapshot.project.id),
            eq(projects.producerId, scope.producerId),
            eq(projects.clientContactId, snapshot.purchase.clientContactId),
            eq(projects.lifecycleStatus, from),
          ),
        )
        .returning({ id: projects.id });
      return rows.length === 1;
    },
    insertPauseEvent: async (input: NewProjectPaymentPauseEvent) => {
      const [row] = await tx.insert(projectPaymentPauseEvents).values(input).returning();
      if (!row) throw new Error("Payment pause event insert did not return a row");
      return row as ProjectPaymentPauseEventRecord;
    },
  };
}

export function purchaseLedgerRepositoryForTransaction(
  tx: PurchaseLedgerTransactionDb,
  expectedScope: LedgerScope,
): PurchaseLedgerRepository {
  return {
    atomically: async (scope, work) => {
      if (
        scope.purchaseId !== expectedScope.purchaseId ||
        scope.producerId !== expectedScope.producerId
      ) {
        throw new PurchaseLedgerDomainError("NOT_FOUND", "Purchase ledger was not found");
      }
      return work(transactionAdapter(tx, scope));
    },
  };
}

export function purchaseLedgerRepository(db: Db): PurchaseLedgerRepository {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        await lockPurchaseLedgerScope(tx, scope);
        return work(transactionAdapter(tx, scope));
      }),
  };
}
