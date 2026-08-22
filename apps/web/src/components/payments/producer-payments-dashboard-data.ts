import type { PaymentReadModel } from "~/server/domain/purchase-ledger/read-model";

import type {
  ProducerPaymentRecord,
  ProducerPaymentsData,
} from "./producer-payments-dashboard-model";

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * Maps the already authorized, producer-scoped ledger projection to the small
 * serializable contract used only by global Producer Payments.
 */
export function toProducerPaymentsDashboardData(model: PaymentReadModel): ProducerPaymentsData {
  const records: ProducerPaymentRecord[] = model.projects.flatMap((project) =>
    project.purchases.map((purchase) => ({
      id: purchase.id,
      producerId: purchase.producerId,
      clientContactId: purchase.clientContactId,
      clientName: purchase.clientName,
      projectId: project.id,
      projectTitle: project.title,
      projectLifecycleStatus: project.lifecycleStatus,
      purchaseTitle: purchase.commercialSnapshot.productOrOfferName,
      purchaseReference: purchase.refNumber,
      purchaseLifecycleStatus: purchase.lifecycleStatus,
      isImportedExistingWork: purchase.sourceKind === "imported_existing_work",
      currency: purchase.currency,
      totalCents: purchase.totalCents,
      paidCents: purchase.paidCents,
      dueNowCents: purchase.dueNowCents,
      totalRemainingCents: purchase.totalRemainingCents,
      installments: purchase.installments.map((installment) => ({
        id: installment.id,
        amountCents: installment.amountCents,
        paidCents: installment.paidCents,
        waivedCents: installment.waivedCents,
        remainingCents: installment.remainingCents,
        dueAtIso: iso(installment.dueAt),
        triggeredAtIso: iso(installment.triggeredAt),
        dueTrigger: installment.dueTrigger,
        status: installment.status,
      })),
      nextPayment: purchase.nextPayment
        ? {
            installmentId: purchase.nextPayment.installmentId,
            amountCents: purchase.nextPayment.amountCents,
            dueAtIso: iso(purchase.nextPayment.dueAt),
            triggeredAtIso: iso(
              purchase.installments.find(
                (installment) => installment.id === purchase.nextPayment?.installmentId,
              )?.triggeredAt ?? null,
            ),
            dueTrigger: purchase.nextPayment.dueTrigger,
            status: purchase.nextPayment.status,
          }
        : null,
      payments: purchase.payments.map((payment) => ({
        id: payment.id,
        installmentId: payment.installmentId,
        proofId: payment.proofId,
        source: payment.source,
        originalAmountCents: payment.amountCents,
        effectiveAmountCents: payment.effectiveAmountCents,
        paidAtIso: payment.paidAt.toISOString(),
        note: payment.note,
      })),
      corrections: purchase.corrections.map((correction) => ({
        id: correction.id,
        paymentId: correction.paymentId,
        previousAmountCents: correction.previousAmountCents,
        newAmountCents: correction.newAmountCents,
        reason: correction.reason,
        occurredAtIso: correction.createdAt.toISOString(),
      })),
      waivers: purchase.waivers.map((waiver) => ({
        id: waiver.id,
        installmentId: waiver.installmentId,
        amountCents: waiver.amountCents,
        reason: waiver.reason,
        occurredAtIso: waiver.createdAt.toISOString(),
      })),
      proofs: purchase.proofs.map((proof) => ({
        id: proof.id,
        installmentId: proof.installmentId,
        amountCents: proof.amountCents,
        currency: proof.currency,
        status: proof.status,
        submittedAtIso: proof.createdAt.toISOString(),
        reviewedAtIso: iso(proof.confirmedAt ?? proof.rejectedAt),
      })),
      cancellation: purchase.cancellation
        ? {
            id: purchase.cancellation.id,
            reason: purchase.cancellation.reason,
            occurredAtIso: purchase.cancellation.canceledAt.toISOString(),
          }
        : null,
    })),
  );

  return { records };
}
