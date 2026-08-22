import type { PaymentPlan, PurchaseCommercialSnapshot } from "@skitza/db";

import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { agreementPdfFromCommercialSnapshot } from "~/lib/agreement-pdf";
import type {
  PaymentBucketProjection,
  PaymentProjectProjection,
  PaymentPurchaseProjection,
} from "~/server/domain/purchase-ledger/read-model";

import type {
  PaymentHistoryFrozenTerms,
  PaymentHistoryInstallment,
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryRecordStatus,
  PaymentHistoryRole,
  PaymentHistorySectionDescriptor,
  PaymentHistoryStatus,
  PaymentHistoryViewData,
} from "./payment-history-view";
import { mapPaymentDeliveryState, splitGoogleDriveDeliverables } from "./delivery-state";

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function planLabel(plan: PaymentPlan | null): string {
  if (plan === null) return "No payment required";
  if (plan.kind === "full") return "Full payment";
  if (plan.kind === "split_50_50") return "50 / 50";
  return `${String(plan.installments)} monthly payments`;
}

function planDescription(plan: PaymentPlan | null): string | null {
  if (plan === null) return "This agreement has a zero total.";
  if (plan.kind === "full") return "The full agreed total is one installment.";
  if (plan.kind === "split_50_50") {
    return "The agreed total is split into two installments.";
  }
  return `The agreed total is split across ${String(plan.installments)} monthly installments.`;
}

function sessionLabel(session: PurchaseCommercialSnapshot["session"]): string {
  if (!session) return "None included";
  const count = session.limit.kind === "unlimited" ? "Unlimited" : String(session.limit.count);
  return `${count} × ${String(session.durationMin)} min · ${session.locationType}`;
}

function revisionLabel(rule: PurchaseCommercialSnapshot["revisionRule"]): string {
  if (!rule) return "Not specified";
  return rule.kind === "unlimited" ? "Unlimited" : `${String(rule.count)} rounds`;
}

function frozenTerms(
  purchase: PaymentPurchaseProjection,
  deliverables: readonly string[],
): PaymentHistoryFrozenTerms {
  const snapshot = purchase.commercialSnapshot;
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const agreementPdf = agreementPdfFromCommercialSnapshot(snapshot);
  const royaltyValue = royalty.specified
    ? [royalty.master, royalty.composition, snapshot.royaltyTerms?.notes]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : "Not specified";
  return {
    frozenAtIso: purchase.commercialEstablishedAt.toISOString(),
    productName: snapshot.productOrOfferName,
    deliverables,
    lineItems: snapshot.lineItems.map((line, index) => ({
      id: `${purchase.id}-line-${String(index + 1)}`,
      label: line.label,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      totalCents: line.totalCents,
    })),
    subtotalCents: snapshot.subtotalCents,
    discountCents: snapshot.discountCents,
    taxCents: snapshot.tax.amountCents,
    totalCents: snapshot.totalCents,
    detailRows: [
      { label: "Song spaces", value: String(snapshot.includedSongSpaces) },
      { label: "Session allowance", value: sessionLabel(snapshot.session) },
      { label: "Revisions", value: revisionLabel(snapshot.revisionRule) },
      { label: "Royalty terms", value: royaltyValue },
    ],
    rights: snapshot.rights,
    agreementText: snapshot.agreementText,
    agreementPdfFileName: agreementPdf?.originalFileName ?? null,
  };
}

function purchaseRecordStatus(purchase: PaymentPurchaseProjection): PaymentHistoryRecordStatus {
  if (purchase.lifecycleStatus === "canceled") return "canceled";
  if (purchase.totalCents === 0 && purchase.installments.length === 0) {
    return "no_payment_required";
  }
  if (purchase.waivedCents > 0 && purchase.totalRemainingCents === 0) {
    return "settled_by_waiver";
  }
  if (purchase.fullyPaid) return "paid_in_full";
  return "open";
}

function purchaseStatus(
  purchase: PaymentPurchaseProjection,
  recordStatus: PaymentHistoryRecordStatus,
): PaymentHistoryStatus {
  if (recordStatus === "canceled") return { label: "Canceled", tone: "neutral" };
  if (recordStatus === "no_payment_required") {
    return { label: "No payment required", tone: "neutral" };
  }
  if (recordStatus === "settled_by_waiver") {
    return { label: "Settled by waiver", tone: "neutral" };
  }
  if (recordStatus === "paid_in_full") return { label: "Paid in full", tone: "success" };
  if (purchase.producerBucket === "needs_review") {
    return { label: "Needs review", tone: "accent" };
  }
  if (purchase.dueNowCents > 0) {
    const overdue = purchase.installments.some(
      (installment) => installment.status === "overdue" && installment.remainingCents > 0,
    );
    return { label: overdue ? "Overdue" : "Due now", tone: overdue ? "danger" : "warning" };
  }
  if (purchase.lifecycleStatus === "waiting_for_payment") {
    return { label: "Waiting for payment", tone: "warning" };
  }
  return { label: "Upcoming", tone: "active" };
}

function projectStatus(project: PaymentProjectProjection): PaymentHistoryStatus {
  const hasBalance = project.purchases.some((purchase) => purchase.totalRemainingCents > 0);
  if (project.lifecycleStatus === "completed") {
    return {
      label: hasBalance ? "Archived · balance remains" : "Archived · completed",
      tone: hasBalance ? "warning" : "neutral",
    };
  }
  if (project.lifecycleStatus === "canceled") {
    return {
      label: hasBalance ? "Archived · balance remains" : "Archived · canceled",
      tone: hasBalance ? "warning" : "neutral",
    };
  }
  if (project.lifecycleStatus === "paused") return { label: "Paused", tone: "warning" };
  if (project.lifecycleStatus === "waiting_for_payment") {
    return { label: "Waiting for payment", tone: "warning" };
  }
  return { label: "Active", tone: "active" };
}

function triggerLabel(trigger: PaymentHistoryInstallment["trigger"]): string | null {
  if (trigger === "acceptance") return "At acceptance";
  if (trigger === "producer_import") return "When added to Skitza";
  if (trigger === "artist_approval") return "When the artist approves the final version";
  if (trigger === "monthly_anniversary") return "Monthly anniversary";
  return trigger;
}

function installmentStatus(
  status: PaymentPurchaseProjection["installments"][number]["status"],
): PaymentHistoryStatus {
  switch (status) {
    case "confirmed":
      return { label: "Paid", tone: "success" };
    case "waived":
      return { label: "Waived", tone: "neutral" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
    case "awaiting_review":
      return { label: "Needs review", tone: "accent" };
    case "overdue":
      return { label: "Overdue", tone: "danger" };
    case "partially_paid":
      return { label: "Partially paid", tone: "warning" };
    case "not_paid":
      return { label: "Not paid", tone: "warning" };
  }
}

function mapPurchase(
  purchase: PaymentPurchaseProjection,
  role: PaymentHistoryRole,
): PaymentHistoryPurchase {
  const recordStatus = purchaseRecordStatus(purchase);
  const installmentPosition = new Map(
    purchase.installments.map((installment) => [installment.id, installment.position]),
  );
  const paymentById = new Map(purchase.payments.map((payment) => [payment.id, payment]));
  const instructionFields = purchase.currentInstructions
    ? [
        purchase.currentInstructions.bankTransfer
          ? { label: "Bank transfer", value: purchase.currentInstructions.bankTransfer }
          : null,
        purchase.currentInstructions.bitPhone
          ? { label: "Bit phone", value: purchase.currentInstructions.bitPhone }
          : null,
      ].filter((field): field is { label: string; value: string } => field !== null)
    : [];
  const deliverables = splitGoogleDriveDeliverables(purchase.commercialSnapshot.deliverables);
  const overdue = purchase.installments.some(
    (installment) => installment.status === "overdue" && installment.remainingCents > 0,
  );
  const delivery = mapPaymentDeliveryState({
    fullyPaid: purchase.fullyPaid,
    totalCents: purchase.totalCents,
    paidCents: purchase.paidCents,
    waivedCents: purchase.waivedCents,
    remainingCents: purchase.totalRemainingCents,
    overdue,
    activeOverrideVersionLabels: purchase.activeDownloadOverrides.map(
      (override) => override.versionLabel,
    ),
    googleDriveLinks: deliverables.googleDriveLinks,
    withheldGoogleDriveLinkCount: deliverables.googleDriveLinks.length,
  });

  return {
    id: purchase.id,
    studioId: purchase.producerId,
    reference: purchase.refNumber,
    title: purchase.commercialSnapshot.productOrOfferName,
    counterpartyId: role === "producer" ? purchase.clientContactId : null,
    counterpartyLabel: role === "producer" ? purchase.clientName : purchase.producerName,
    currency: purchase.currency,
    status: purchaseStatus(purchase, recordStatus),
    recordStatus,
    defaultOpen:
      purchase.collection === "active" ||
      purchase.proofs.some((proof) => proof.status === "pending" || proof.status === "rejected"),
    totalCents: purchase.totalCents,
    paidCents: purchase.paidCents,
    dueNowCents: purchase.dueNowCents,
    totalRemainingCents: purchase.totalRemainingCents,
    delivery,
    frozenTerms: frozenTerms(purchase, deliverables.labels),
    agreementRecord:
      purchase.provenance.kind === "artist_acceptance"
        ? {
            kind: "artist_acceptance",
            establishedAtIso: purchase.provenance.acceptedAt.toISOString(),
            headline: `${purchase.clientName} accepted the exact terms`,
            statement:
              "The agreement, price, plan, and schedule above are the frozen accepted record.",
          }
        : {
            kind: "producer_import",
            establishedAtIso: purchase.provenance.importedAt.toISOString(),
            headline: purchase.provenance.notice,
            statement:
              "The outside agreement, price, plan, and schedule above are frozen in Skitza.",
          },
    plan: {
      label: planLabel(purchase.commercialSnapshot.selectedPaymentPlan),
      description: planDescription(purchase.commercialSnapshot.selectedPaymentPlan),
    },
    schedule: purchase.installments.map((installment) => ({
      id: installment.id,
      position: installment.position,
      label: `Payment ${String(installment.position)}`,
      amountCents: installment.amountCents,
      paidCents: installment.paidCents,
      waivedCents: installment.waivedCents,
      remainingCents: installment.remainingCents,
      dueAtIso: iso(installment.dueAt),
      trigger: triggerLabel(installment.dueTrigger),
      status: installmentStatus(installment.status),
    })),
    nextPayment: purchase.nextPayment
      ? {
          amountCents: purchase.nextPayment.amountCents,
          dueAtIso: iso(purchase.nextPayment.dueAt),
          trigger: triggerLabel(purchase.nextPayment.dueTrigger),
        }
      : null,
    showPayNextPayment: purchase.showPayNextPayment,
    currentInstructions: purchase.currentInstructions
      ? {
          title: "Current producer payment instructions",
          updatedAtIso: null,
          fields: instructionFields,
          note: purchase.currentInstructions.note ?? null,
        }
      : null,
    proofs: purchase.proofs.map((proof) => ({
      id: proof.id,
      installmentLabel:
        `Payment ${String(installmentPosition.get(proof.installmentId) ?? "")}`.trim(),
      amountCents: proof.amountCents,
      currency: proof.currency,
      status: proof.status,
      originalFileName: proof.originalFileName,
      submittedAtIso: proof.createdAt.toISOString(),
      reviewedAtIso: iso(proof.confirmedAt ?? proof.rejectedAt),
      note: proof.note,
      rejectionNote: proof.rejectionNote,
      detailAvailable: role === "producer",
    })),
    payments: purchase.payments.map((payment) => ({
      id: payment.id,
      installmentLabel:
        `Payment ${String(installmentPosition.get(payment.installmentId) ?? "")}`.trim(),
      amountCents: payment.effectiveAmountCents,
      currency: payment.currency,
      paidAtIso: payment.paidAt.toISOString(),
      sourceLabel:
        payment.source === "proof"
          ? "Confirmed from proof"
          : purchase.sourceKind === "imported_existing_work"
            ? "Confirmed by producer"
            : "Recorded manually",
      note: payment.note,
    })),
    corrections: purchase.corrections.map((correction) => ({
      id: correction.id,
      label: "Payment corrected",
      amountDeltaCents: correction.newAmountCents - correction.previousAmountCents,
      currency: paymentById.get(correction.paymentId)?.currency ?? purchase.currency,
      occurredAtIso: correction.createdAt.toISOString(),
      reason: correction.reason,
    })),
    waivers: purchase.waivers.map((waiver) => ({
      id: waiver.id,
      installmentLabel:
        `Payment ${String(installmentPosition.get(waiver.installmentId) ?? "")}`.trim(),
      amountCents: waiver.amountCents,
      currency: purchase.currency,
      occurredAtIso: waiver.createdAt.toISOString(),
      reason: waiver.reason,
    })),
    cancellations: purchase.cancellation
      ? [
          {
            id: purchase.cancellation.id,
            occurredAtIso: purchase.cancellation.canceledAt.toISOString(),
            reason: purchase.cancellation.reason,
          },
        ]
      : [],
    pauseHistory: purchase.pauseEvents.map((event) => ({
      id: event.id,
      actionLabel: event.action === "paused" ? "Payments paused" : "Payments resumed",
      occurredAtIso: event.changedAt.toISOString(),
      reason: event.reason,
    })),
    downloadOverrideHistory: purchase.downloadOverrides.map((event) => ({
      id: event.id,
      actionLabel: event.enabled ? "Early download allowed" : "Early download removed",
      trackVersionLabel: event.versionLabel,
      occurredAtIso: event.createdAt.toISOString(),
      reason: event.enabled
        ? "The producer enabled the recorded version override."
        : "The producer removed the recorded version override.",
      expiresAtIso: null,
    })),
  };
}

function mapProject(
  project: PaymentProjectProjection,
  role: PaymentHistoryRole,
): PaymentHistoryProject {
  return {
    id: project.id,
    title: project.title,
    status: projectStatus(project),
    currencyTotals: project.totals,
    purchases: project.purchases.map((purchase) => mapPurchase(purchase, role)),
  };
}

/** Pure presentation adapter. Bucketing and all amounts already belong to the domain projection. */
export function toPaymentHistoryViewData(
  bucket: PaymentBucketProjection,
  section: PaymentHistorySectionDescriptor,
  role: PaymentHistoryRole,
): PaymentHistoryViewData {
  return {
    section,
    currencyTotals: bucket.totals,
    projects: bucket.projects.map((project) => mapProject(project, role)),
  };
}

export function allPaymentsBucket(
  projects: readonly PaymentProjectProjection[],
  totals: PaymentBucketProjection["totals"],
): PaymentBucketProjection {
  return { projects, totals };
}
