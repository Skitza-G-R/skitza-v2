import type { Purchase, PurchaseInstallment } from "@skitza/db";

/**
 * SK-269 — the producer says the imported work is finished.
 *
 * On a 50/50 plan the second half is written with `due_trigger =
 * 'artist_approval'` and no date at all: it becomes collectible only when the
 * artist approves the final version inside Skitza. That is the right rule for
 * work sold through Skitza, and the wrong one for work the producer imported
 * by hand — such a client may never join, and the songs usually pre-date
 * Skitza, so the approval can never happen. Without a producer-side trigger
 * the outstanding half is invisible to every "due now" reader, cannot be
 * recorded, and cannot even be waived (`waiveInstallmentDebt` refuses an
 * untriggered installment), so the debt is stuck forever.
 *
 * 50/50 is a milestone plan: the money is owed when the work is done. On
 * imported work the only person who can say the work is done is the producer,
 * so this is the one place where they may say it. Everything else — a normal
 * purchase, a monthly plan, an already-triggered half — stays untouched.
 *
 * This module is the single source of that rule. The Payments tab uses it to
 * decide whether to offer the control, and `requestImportedFinalPayment` uses
 * the same answer to decide whether to honour the request, so a hidden button
 * and a refused mutation can never disagree.
 */

export type FinalPaymentPurchaseInput = Readonly<{
  sourceKind: Purchase["sourceKind"];
  lifecycleStatus: Purchase["lifecycleStatus"];
}>;

export type FinalPaymentInstallmentInput = Readonly<{
  id: string;
  dueTrigger: PurchaseInstallment["dueTrigger"];
  dueAt: Date | null;
  triggeredAt: Date | null;
  status: PurchaseInstallment["status"];
}>;

export type FinalPaymentUnavailableReason =
  /** Not imported work. Only the artist's own approval may trigger this half. */
  | "not_imported_work"
  /** No half of this purchase waits on a finished-work milestone. */
  | "no_final_payment"
  | "purchase_canceled"
  /** The final half is already paid, waived, canceled, or under review. */
  | "final_payment_closed";

export type FinalPaymentRequestDecision =
  | Readonly<{ status: "ready"; installmentId: string }>
  | Readonly<{ status: "already_requested"; installmentId: string }>
  | Readonly<{ status: "unavailable"; reason: FinalPaymentUnavailableReason }>;

/**
 * Decide whether the producer may turn a purchase's milestone half into money
 * that is owed today. Pass `installmentId` to ask about one exact row (the
 * mutation always does); leave it out to ask "does this purchase have one?"
 */
export function decideFinalPaymentRequest(
  input: Readonly<{
    purchase: FinalPaymentPurchaseInput;
    installments: readonly FinalPaymentInstallmentInput[];
    installmentId?: string | undefined;
  }>,
): FinalPaymentRequestDecision {
  if (input.purchase.sourceKind !== "imported_existing_work") {
    return { status: "unavailable", reason: "not_imported_work" };
  }
  const waiting = input.installments.filter(
    (installment) => installment.dueTrigger === "artist_approval",
  );
  const target =
    input.installmentId === undefined
      ? waiting[0]
      : waiting.find((installment) => installment.id === input.installmentId);
  if (!target) return { status: "unavailable", reason: "no_final_payment" };

  // Already asked for. The due date is immutable once written, so a second
  // press is a no-op rather than an error.
  if (target.triggeredAt !== null || target.dueAt !== null) {
    return { status: "already_requested", installmentId: target.id };
  }
  if (input.purchase.lifecycleStatus === "canceled") {
    return { status: "unavailable", reason: "purchase_canceled" };
  }
  if (target.status !== "not_paid") {
    return { status: "unavailable", reason: "final_payment_closed" };
  }
  return { status: "ready", installmentId: target.id };
}

export const FINAL_PAYMENT_UNAVAILABLE_MESSAGES: Readonly<
  Record<FinalPaymentUnavailableReason, string>
> = {
  not_imported_work: "Only imported work can be marked finished here.",
  no_final_payment: "This purchase has no payment waiting on the finished work.",
  purchase_canceled: "This purchase is canceled.",
  final_payment_closed: "That payment is already settled.",
};
