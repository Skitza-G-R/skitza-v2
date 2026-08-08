import type {
  PaymentHistoryPurchase,
  PaymentHistoryRecordStatus,
  PaymentHistoryStatus,
} from "~/components/payments/payment-history-view";
import {
  allPaymentsBucket,
  toPaymentHistoryViewData,
} from "~/components/payments/payment-history-adapter";
import type {
  PaymentProjectProjection,
  PaymentPurchaseProjection,
  PaymentReadModel,
} from "~/server/domain/purchase-ledger/read-model";

export type ClientPaymentDueTrigger =
  PaymentPurchaseProjection["installments"][number]["dueTrigger"];
export type ClientPaymentInstallmentStatus =
  PaymentPurchaseProjection["installments"][number]["status"];

export interface ClientPaymentInstallmentData {
  id: string;
  position: number;
  label: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  currency: string;
  dueAtIso: string | null;
  triggeredAtIso: string | null;
  dueTrigger: ClientPaymentDueTrigger;
  triggerLabel: string | null;
  status: ClientPaymentInstallmentStatus;
  statusPresentation: PaymentHistoryStatus;
}

export interface ClientPaymentProofData {
  id: string;
  installmentId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "confirmed" | "rejected";
  originalFileName: string | null;
  submittedAtIso: string;
}

export interface ClientPaymentPurchaseData {
  id: string;
  title: string;
  reference: string;
  currency: string;
  totalCents: number;
  paidCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
  recordStatus: PaymentHistoryRecordStatus;
  installments: readonly ClientPaymentInstallmentData[];
  proofs: readonly ClientPaymentProofData[];
  details: PaymentHistoryPurchase;
}

export interface ClientPaymentProjectData {
  id: string;
  title: string;
  lifecycleStatus: PaymentProjectProjection["lifecycleStatus"];
  status: PaymentHistoryStatus;
  purchases: readonly ClientPaymentPurchaseData[];
}

export interface ClientPaymentsData {
  asOfIso: string;
  producerTimeZone: string;
  projects: readonly ClientPaymentProjectData[];
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/**
 * Serializes the already-authorized, producer-scoped ledger for the distinct
 * Client Payments presentation. No amounts or ledger states are reclassified here.
 */
export function toClientPaymentsData(
  model: PaymentReadModel,
  input: Readonly<{ asOf: Date; producerTimeZone: string }>,
): ClientPaymentsData {
  const details = toPaymentHistoryViewData(
    allPaymentsBucket(model.projects, model.totals),
    {
      id: "client-payment-records",
      eyebrow: "Payments",
      title: "Payment records",
      description: "",
      emptyTitle: "No payments",
      emptyDescription: "",
    },
    "producer",
  );
  const detailProjectById = new Map(details.projects.map((project) => [project.id, project]));

  return {
    asOfIso: input.asOf.toISOString(),
    producerTimeZone: input.producerTimeZone,
    projects: model.projects.map((project) => {
      const detailProject = required(
        detailProjectById.get(project.id),
        "Client payment project lost its canonical detail record",
      );
      const detailPurchaseById = new Map(
        detailProject.purchases.map((purchase) => [purchase.id, purchase]),
      );

      return {
        id: project.id,
        title: project.title,
        lifecycleStatus: project.lifecycleStatus,
        status: detailProject.status,
        purchases: project.purchases.map((purchase) => {
          const detailPurchase = required(
            detailPurchaseById.get(purchase.id),
            "Client payment purchase lost its canonical detail record",
          );
          const detailInstallmentById = new Map(
            detailPurchase.schedule.map((installment) => [installment.id, installment]),
          );

          return {
            id: purchase.id,
            title: detailPurchase.title,
            reference: purchase.refNumber,
            currency: purchase.currency,
            totalCents: purchase.totalCents,
            paidCents: purchase.paidCents,
            dueNowCents: purchase.dueNowCents,
            totalRemainingCents: purchase.totalRemainingCents,
            recordStatus: detailPurchase.recordStatus,
            installments: purchase.installments.map((installment) => {
              const detailInstallment = required(
                detailInstallmentById.get(installment.id),
                "Client payment installment lost its canonical detail record",
              );
              return {
                id: installment.id,
                position: installment.position,
                label: detailInstallment.label,
                amountCents: installment.amountCents,
                paidCents: installment.paidCents,
                waivedCents: installment.waivedCents,
                remainingCents: installment.remainingCents,
                currency: installment.currency,
                dueAtIso: installment.dueAt?.toISOString() ?? null,
                triggeredAtIso: installment.triggeredAt?.toISOString() ?? null,
                dueTrigger: installment.dueTrigger,
                triggerLabel: detailInstallment.trigger,
                status: installment.status,
                statusPresentation: detailInstallment.status,
              };
            }),
            proofs: [...purchase.proofs]
              .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
              .map((proof) => ({
                id: proof.id,
                installmentId: proof.installmentId,
                amountCents: proof.amountCents,
                currency: proof.currency,
                status: proof.status,
                originalFileName: proof.originalFileName,
                submittedAtIso: proof.createdAt.toISOString(),
              })),
            details: detailPurchase,
          };
        }),
      };
    }),
  };
}
