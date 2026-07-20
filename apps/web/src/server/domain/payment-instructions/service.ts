import {
  and,
  asc,
  clientContacts,
  eq,
  inArray,
  producers,
  purchaseInstallments,
  purchasePaymentCorrections,
  purchasePayments,
  purchases,
  purchaseWaivers,
  type Db,
} from "@skitza/db";

import { activeArtistClientOwner } from "~/server/artist/access";

import { summarizePurchaseLedger } from "../purchases/ledger";
import {
  hasPaymentInstructions,
  isInstallmentPayableForInstructions,
  normalizePaymentInstructions,
  type PaymentInstructions,
} from "./policy";

export class PaymentInstructionsNotFoundError extends Error {
  constructor() {
    super("Payment instructions were not found");
    this.name = "PaymentInstructionsNotFoundError";
  }
}

export type ArtistPaymentInstructionReference =
  | Readonly<{
      purchaseId: string;
      installmentId?: string | undefined;
    }>
  | Readonly<{
      purchaseRequestId: string;
      installmentId?: string | undefined;
    }>;

export type ArtistInstallmentPaymentInstructions = Readonly<{
  purchaseId: string;
  installmentId: string;
  installmentPosition: number;
  installmentStatus: (typeof purchaseInstallments.$inferSelect)["status"];
  installmentDueAt: Date | null;
  refNumber: string;
  productId: string | null;
  productName: string;
  planKind: NonNullable<(typeof purchases.$inferSelect)["paymentPlanKind"]>;
  planInstallments: number | null;
  currency: string;
  totalCents: number;
  paidCents: number;
  pendingProofCents: number;
  remainingCents: number;
  amountDueNowCents: number;
  availableToSubmitCents: number;
  producerName: string | null;
  proofUploadsAvailable: boolean;
  hasDetails: boolean;
  bankTransfer: string | null;
  bitPhone: string | null;
  note: string | null;
}>;

export async function getProducerPaymentInstructions(
  db: Db,
  producerId: string,
): Promise<PaymentInstructions> {
  const [row] = await db
    .select({ paymentDetails: producers.paymentDetails })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1);
  if (!row) throw new PaymentInstructionsNotFoundError();
  return normalizePaymentInstructions(row.paymentDetails);
}

export async function saveProducerPaymentInstructions(
  db: Db,
  producerId: string,
  input: PaymentInstructions,
): Promise<PaymentInstructions> {
  const normalized = normalizePaymentInstructions(input);
  const paymentDetails = {
    ...(normalized.bankTransfer === undefined ? {} : { bankTransfer: normalized.bankTransfer }),
    ...(normalized.bitPhone === undefined ? {} : { bitPhone: normalized.bitPhone }),
    ...(normalized.note === undefined ? {} : { note: normalized.note }),
  };
  const [updated] = await db
    .update(producers)
    .set({ paymentDetails, updatedAt: new Date() })
    .where(eq(producers.id, producerId))
    .returning({ id: producers.id });
  if (!updated) throw new PaymentInstructionsNotFoundError();
  return normalized;
}

function paymentAmountsAfterCorrections(
  payments: ReadonlyArray<{
    id: string;
    installmentId: string;
    amountCents: number;
  }>,
  corrections: ReadonlyArray<{
    paymentId: string;
    sequence: number;
    newAmountCents: number;
  }>,
): Map<string, { installmentId: string; amountCents: number }> {
  const amounts = new Map(
    payments.map((payment) => [
      payment.id,
      { installmentId: payment.installmentId, amountCents: payment.amountCents },
    ]),
  );
  const ordered = [...corrections].sort((left, right) => left.sequence - right.sequence);
  for (const correction of ordered) {
    const payment = amounts.get(correction.paymentId);
    if (!payment) continue;
    amounts.set(correction.paymentId, {
      installmentId: payment.installmentId,
      amountCents: correction.newAmountCents,
    });
  }
  return amounts;
}

function addByInstallment(
  values: Iterable<{ installmentId: string; amountCents: number }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const value of values) {
    totals.set(value.installmentId, (totals.get(value.installmentId) ?? 0) + value.amountCents);
  }
  return totals;
}

/**
 * Resolve current producer instructions only through an accepted Purchase and
 * one of its payable installments. The stable client-contact ownership join
 * collapses missing, foreign, and disconnected records into the same result.
 */
export async function loadArtistInstallmentPaymentInstructions(
  db: Db,
  clerkUserId: string,
  reference: ArtistPaymentInstructionReference,
  now = new Date(),
): Promise<ArtistInstallmentPaymentInstructions> {
  const purchasePredicate =
    "purchaseId" in reference
      ? eq(purchases.id, reference.purchaseId)
      : eq(purchases.purchaseRequestId, reference.purchaseRequestId);

  // Always load the complete immutable schedule. Even when the caller asks
  // for one installment, purchase-level balance must preserve exact-
  // installment allocation and exclude canceled future debt.
  const candidates = await db
    .select({
      purchaseId: purchases.id,
      producerId: purchases.producerId,
      productId: purchases.productId,
      refNumber: purchases.refNumber,
      paymentPlanKind: purchases.paymentPlanKind,
      commercialSnapshot: purchases.commercialSnapshot,
      totalCents: purchases.totalCents,
      installmentId: purchaseInstallments.id,
      installmentPosition: purchaseInstallments.position,
      installmentAmountCents: purchaseInstallments.amountCents,
      installmentCurrency: purchaseInstallments.currency,
      installmentStatus: purchaseInstallments.status,
      installmentDueTrigger: purchaseInstallments.dueTrigger,
      installmentDueAt: purchaseInstallments.dueAt,
      installmentTriggeredAt: purchaseInstallments.triggeredAt,
      producerName: producers.displayName,
      paymentDetails: producers.paymentDetails,
    })
    .from(purchaseInstallments)
    .innerJoin(
      purchases,
      and(
        eq(purchases.id, purchaseInstallments.purchaseId),
        eq(purchases.producerId, purchaseInstallments.producerId),
      ),
    )
    .innerJoin(
      clientContacts,
      activeArtistClientOwner(clerkUserId, {
        producerId: purchases.producerId,
        clientContactId: purchases.clientContactId,
      }),
    )
    .innerJoin(producers, eq(producers.id, purchases.producerId))
    .where(purchasePredicate)
    .orderBy(asc(purchaseInstallments.position));

  const first = candidates[0];
  if (!first) {
    throw new PaymentInstructionsNotFoundError();
  }

  const payments = await db
    .select({
      id: purchasePayments.id,
      installmentId: purchasePayments.installmentId,
      amountCents: purchasePayments.amountCents,
      paidAt: purchasePayments.paidAt,
    })
    .from(purchasePayments)
    .where(
      and(
        eq(purchasePayments.purchaseId, first.purchaseId),
        eq(purchasePayments.producerId, first.producerId),
      ),
    );
  const paymentIds = payments.map((payment) => payment.id);
  const corrections =
    paymentIds.length === 0
      ? []
      : await db
          .select({
            id: purchasePaymentCorrections.id,
            paymentId: purchasePaymentCorrections.paymentId,
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
              eq(purchasePaymentCorrections.purchaseId, first.purchaseId),
              eq(purchasePaymentCorrections.producerId, first.producerId),
              inArray(purchasePaymentCorrections.paymentId, paymentIds),
            ),
          );
  const waivers = await db
    .select({
      id: purchaseWaivers.id,
      installmentId: purchaseWaivers.installmentId,
      amountCents: purchaseWaivers.amountCents,
      reason: purchaseWaivers.reason,
      waivedByClerkUserId: purchaseWaivers.waivedByClerkUserId,
      createdAt: purchaseWaivers.createdAt,
    })
    .from(purchaseWaivers)
    .where(
      and(
        eq(purchaseWaivers.purchaseId, first.purchaseId),
        eq(purchaseWaivers.producerId, first.producerId),
      ),
    );

  const correctedPayments = paymentAmountsAfterCorrections(payments, corrections);
  const paidByInstallment = addByInstallment(correctedPayments.values());
  const waivedByInstallment = addByInstallment(waivers);
  const installmentPositionById = new Map(
    candidates.map((candidate) => [candidate.installmentId, candidate.installmentPosition]),
  );
  const installmentPosition = (installmentId: string): number => {
    const position = installmentPositionById.get(installmentId);
    if (position === undefined) throw new PaymentInstructionsNotFoundError();
    return position;
  };
  const ledger = summarizePurchaseLedger({
    totalCents: first.totalCents,
    schedule: candidates.map((candidate) => ({
      sequence: candidate.installmentPosition,
      amountCents: candidate.installmentAmountCents,
      trigger: candidate.installmentDueTrigger,
      status: candidate.installmentStatus,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      installmentSequence: installmentPosition(payment.installmentId),
      amountCents: payment.amountCents,
      confirmedAt: payment.paidAt,
    })),
    corrections: corrections.map((correction) => ({
      id: correction.id,
      paymentId: correction.paymentId,
      sequence: correction.sequence,
      oldAmountCents: correction.previousAmountCents,
      newAmountCents: correction.newAmountCents,
      reason: correction.reason,
      actorId: correction.correctedByClerkUserId,
      correctedAt: correction.createdAt,
    })),
    waivers: waivers.map((waiver) => ({
      id: waiver.id,
      installmentSequence: installmentPosition(waiver.installmentId),
      amountCents: waiver.amountCents,
      reason: waiver.reason,
      actorId: waiver.waivedByClerkUserId,
      waivedAt: waiver.createdAt,
    })),
  });
  const selected = candidates.find((candidate) => {
    if (reference.installmentId && candidate.installmentId !== reference.installmentId) {
      return false;
    }
    if (
      !isInstallmentPayableForInstructions(
        {
          status: candidate.installmentStatus,
          dueTrigger: candidate.installmentDueTrigger,
          dueAt: candidate.installmentDueAt,
          triggeredAt: candidate.installmentTriggeredAt,
        },
        now,
      )
    ) {
      return false;
    }
    const paid = paidByInstallment.get(candidate.installmentId) ?? 0;
    const waived = waivedByInstallment.get(candidate.installmentId) ?? 0;
    return candidate.installmentAmountCents - paid - waived > 0;
  });
  if (!selected || selected.paymentPlanKind === null) {
    throw new PaymentInstructionsNotFoundError();
  }

  const installmentRemainingCents = Math.max(
    0,
    selected.installmentAmountCents -
      (paidByInstallment.get(selected.installmentId) ?? 0) -
      (waivedByInstallment.get(selected.installmentId) ?? 0),
  );
  const instructions = normalizePaymentInstructions(selected.paymentDetails);
  const selectedPlan = selected.commercialSnapshot.selectedPaymentPlan;
  const planInstallments = selectedPlan?.kind === "monthly" ? selectedPlan.installments : null;

  return Object.freeze({
    purchaseId: selected.purchaseId,
    installmentId: selected.installmentId,
    installmentPosition: selected.installmentPosition,
    installmentStatus: selected.installmentStatus,
    installmentDueAt: selected.installmentDueAt,
    refNumber: selected.refNumber,
    productId: selected.productId,
    productName: selected.commercialSnapshot.productOrOfferName,
    planKind: selected.paymentPlanKind,
    planInstallments,
    currency: selected.installmentCurrency,
    totalCents: selected.totalCents,
    paidCents: ledger.paidCents,
    pendingProofCents: 0,
    remainingCents: ledger.remainingBalanceCents,
    amountDueNowCents: installmentRemainingCents,
    availableToSubmitCents: installmentRemainingCents,
    producerName: selected.producerName,
    proofUploadsAvailable: true,
    hasDetails: hasPaymentInstructions(instructions),
    bankTransfer: instructions.bankTransfer ?? null,
    bitPhone: instructions.bitPhone ?? null,
    note: instructions.note ?? null,
  });
}
