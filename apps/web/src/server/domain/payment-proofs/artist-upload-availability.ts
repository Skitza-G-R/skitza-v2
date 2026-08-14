import type { PurchaseInstallment } from "@skitza/db";

type DueTrigger = PurchaseInstallment["dueTrigger"];

export type ArtistProofUploadAvailability =
  | Readonly<{ status: "available" }>
  | Readonly<{ status: "awaiting_review" }>
  | Readonly<{ status: "paid_in_full" }>
  | Readonly<{ status: "studio_closed" }>
  | Readonly<{ status: "purchase_canceled" }>
  | Readonly<{
      status: "not_due";
      installmentPosition: number;
      dueTrigger: DueTrigger;
      dueAt: Date | null;
    }>
  | Readonly<{ status: "unavailable" }>;

type AvailabilityInput = Readonly<{
  studioClosed: boolean;
  purchaseCanceled: boolean;
  hasPendingProof: boolean;
  paidInFull: boolean;
  selectedPayable: boolean;
  selectedRemainingCents: number;
  nextOutstandingInstallment: Readonly<{
    position: number;
    dueTrigger: DueTrigger;
    dueAt: Date | null;
  }> | null;
}>;

/**
 * Explain the existing proof gate without weakening it. The uploader opens only
 * for the exact payable installment and never for a future, pending, settled,
 * or canceled payment.
 */
export function resolveArtistProofUploadAvailability(
  input: AvailabilityInput,
): ArtistProofUploadAvailability {
  if (input.studioClosed) return Object.freeze({ status: "studio_closed" });
  if (input.purchaseCanceled) return Object.freeze({ status: "purchase_canceled" });
  if (input.hasPendingProof) return Object.freeze({ status: "awaiting_review" });
  if (input.paidInFull) return Object.freeze({ status: "paid_in_full" });
  if (input.selectedPayable && input.selectedRemainingCents > 0) {
    return Object.freeze({ status: "available" });
  }
  if (input.nextOutstandingInstallment) {
    return Object.freeze({
      status: "not_due",
      installmentPosition: input.nextOutstandingInstallment.position,
      dueTrigger: input.nextOutstandingInstallment.dueTrigger,
      dueAt: input.nextOutstandingInstallment.dueAt,
    });
  }
  return Object.freeze({ status: "unavailable" });
}
