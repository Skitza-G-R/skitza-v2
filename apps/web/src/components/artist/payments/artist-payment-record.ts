import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

export type ArtistPaymentRecord = Readonly<{
  project: PaymentHistoryProject;
  purchase: PaymentHistoryPurchase;
}>;

/** Locate one already-authorized accepted purchase in the artist ledger projection. */
export function findArtistPaymentRecord(
  sections: readonly PaymentHistoryViewData[],
  purchaseId: string,
): ArtistPaymentRecord | null {
  for (const section of sections) {
    for (const project of section.projects) {
      const purchase = project.purchases.find((candidate) => candidate.id === purchaseId);
      if (purchase) return Object.freeze({ project, purchase });
    }
  }
  return null;
}

/** Zero-total and royalty-only accepted records have no installment proof state. */
export function recordUsesProofFlow(purchase: PaymentHistoryPurchase | null): boolean {
  return Boolean(purchase && purchase.schedule.length > 0);
}
