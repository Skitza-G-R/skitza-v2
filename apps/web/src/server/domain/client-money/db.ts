import {
  and,
  clientContacts,
  eq,
  inArray,
  paymentProofs,
  projects,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchases,
  purchaseWaivers,
  type Db,
} from "@skitza/db";

import type { ClientMoneyRepository, ClientMoneySnapshot } from "./service";

/**
 * Loads all purchase-owned money rows from one repeatable-read snapshot. Every
 * query carries the producer boundary; the domain service verifies every
 * stable client/project/purchase relationship before returning the result.
 */
export function clientMoneyRepository(db: Db): ClientMoneyRepository {
  return {
    loadSnapshot: (scope) =>
      db.transaction(
        async (tx): Promise<ClientMoneySnapshot | null> => {
          const [client] = await tx
            .select({
              id: clientContacts.id,
              producerId: clientContacts.producerId,
            })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.id, scope.clientContactId),
                eq(clientContacts.producerId, scope.producerId),
              ),
            )
            .limit(1);

          if (!client) return null;

          const projectRows = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              clientContactId: projects.clientContactId,
              title: projects.title,
              lifecycleStatus: projects.lifecycleStatus,
              createdAt: projects.createdAt,
            })
            .from(projects)
            .where(
              and(
                eq(projects.producerId, scope.producerId),
                eq(projects.clientContactId, scope.clientContactId),
              ),
            );

          const purchaseRows = await tx
            .select({
              id: purchases.id,
              producerId: purchases.producerId,
              projectId: purchases.projectId,
              clientContactId: purchases.clientContactId,
              refNumber: purchases.refNumber,
              sourceKind: purchases.sourceKind,
              lifecycleStatus: purchases.lifecycleStatus,
              paymentPlanKind: purchases.paymentPlanKind,
              commercialSnapshot: purchases.commercialSnapshot,
              subtotalCents: purchases.subtotalCents,
              taxCents: purchases.taxCents,
              totalCents: purchases.totalCents,
              currency: purchases.currency,
              acceptedAt: purchases.acceptedAt,
              activatedAt: purchases.activatedAt,
              canceledAt: purchases.canceledAt,
            })
            .from(purchases)
            .where(
              and(
                eq(purchases.producerId, scope.producerId),
                eq(purchases.clientContactId, scope.clientContactId),
              ),
            );

          const purchaseIds = purchaseRows.map((purchase) => purchase.id);
          if (purchaseIds.length === 0) {
            return {
              client,
              projects: projectRows,
              purchases: purchaseRows,
              installments: [],
              payments: [],
              corrections: [],
              waivers: [],
              proofs: [],
            };
          }

          const installmentRows = await tx
            .select({
              id: purchaseInstallments.id,
              purchaseId: purchaseInstallments.purchaseId,
              producerId: purchaseInstallments.producerId,
              position: purchaseInstallments.position,
              amountCents: purchaseInstallments.amountCents,
              currency: purchaseInstallments.currency,
              dueTrigger: purchaseInstallments.dueTrigger,
              dueAt: purchaseInstallments.dueAt,
              triggeredAt: purchaseInstallments.triggeredAt,
              requiredForActivation: purchaseInstallments.requiredForActivation,
              status: purchaseInstallments.status,
              createdAt: purchaseInstallments.createdAt,
            })
            .from(purchaseInstallments)
            .where(
              and(
                eq(purchaseInstallments.producerId, scope.producerId),
                inArray(purchaseInstallments.purchaseId, purchaseIds),
              ),
            );

          const paymentRows = await tx
            .select({
              id: purchasePayments.id,
              purchaseId: purchasePayments.purchaseId,
              installmentId: purchasePayments.installmentId,
              producerId: purchasePayments.producerId,
              proofId: purchasePayments.proofId,
              source: purchasePayments.source,
              amountCents: purchasePayments.amountCents,
              currency: purchasePayments.currency,
              paidAt: purchasePayments.paidAt,
              note: purchasePayments.note,
              createdAt: purchasePayments.createdAt,
            })
            .from(purchasePayments)
            .where(
              and(
                eq(purchasePayments.producerId, scope.producerId),
                inArray(purchasePayments.purchaseId, purchaseIds),
              ),
            );

          const correctionRows = await tx
            .select({
              id: purchasePaymentCorrections.id,
              purchaseId: purchasePaymentCorrections.purchaseId,
              paymentId: purchasePaymentCorrections.paymentId,
              producerId: purchasePaymentCorrections.producerId,
              sequence: purchasePaymentCorrections.sequence,
              previousAmountCents: purchasePaymentCorrections.previousAmountCents,
              newAmountCents: purchasePaymentCorrections.newAmountCents,
              reason: purchasePaymentCorrections.reason,
              correctedByClerkUserId: purchasePaymentCorrections.correctedByClerkUserId,
              createdAt: purchasePaymentCorrections.createdAt,
            })
            .from(purchasePaymentCorrections)
            .where(
              and(
                eq(purchasePaymentCorrections.producerId, scope.producerId),
                inArray(purchasePaymentCorrections.purchaseId, purchaseIds),
              ),
            );

          const waiverRows = await tx
            .select({
              id: purchaseWaivers.id,
              purchaseId: purchaseWaivers.purchaseId,
              installmentId: purchaseWaivers.installmentId,
              producerId: purchaseWaivers.producerId,
              amountCents: purchaseWaivers.amountCents,
              reason: purchaseWaivers.reason,
              waivedByClerkUserId: purchaseWaivers.waivedByClerkUserId,
              createdAt: purchaseWaivers.createdAt,
            })
            .from(purchaseWaivers)
            .where(
              and(
                eq(purchaseWaivers.producerId, scope.producerId),
                inArray(purchaseWaivers.purchaseId, purchaseIds),
              ),
            );

          // Deliberately omit storageKey, objectEtag, and storageBucket. The
          // producer projection needs proof metadata, not private object keys.
          const proofRows = await tx
            .select({
              id: paymentProofs.id,
              purchaseId: paymentProofs.purchaseId,
              installmentId: paymentProofs.installmentId,
              producerId: paymentProofs.producerId,
              projectId: paymentProofs.projectId,
              clientContactId: paymentProofs.clientContactId,
              replacesProofId: paymentProofs.replacesProofId,
              amountCents: paymentProofs.amountCents,
              currency: paymentProofs.currency,
              originalFileName: paymentProofs.originalFileName,
              contentType: paymentProofs.contentType,
              sizeBytes: paymentProofs.sizeBytes,
              status: paymentProofs.status,
              note: paymentProofs.note,
              rejectionNote: paymentProofs.rejectionNote,
              confirmedAt: paymentProofs.confirmedAt,
              rejectedAt: paymentProofs.rejectedAt,
              createdAt: paymentProofs.createdAt,
            })
            .from(paymentProofs)
            .where(
              and(
                eq(paymentProofs.producerId, scope.producerId),
                eq(paymentProofs.clientContactId, scope.clientContactId),
                inArray(paymentProofs.purchaseId, purchaseIds),
              ),
            );

          return {
            client,
            projects: projectRows,
            purchases: purchaseRows,
            installments: installmentRows,
            payments: paymentRows,
            corrections: correctionRows,
            waivers: waiverRows,
            proofs: proofRows,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  };
}
