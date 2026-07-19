import type { PurchaseCommercialSnapshot } from "@skitza/db";

import {
  buildStorePurchaseProposalAgreementText,
  buildStorePurchaseSnapshot,
  StoreProductCommercialError,
  type StoreProductCommercialInput,
} from "~/server/domain/store-products/service";

export type PurchaseRequestCommercialProposal = Readonly<
  Omit<PurchaseCommercialSnapshot, "selectedPaymentPlan"> & {
    selectedPaymentPlan: null;
  }
>;

export function isPurchaseRequestApprovalAvailable(
  product: Pick<StoreProductCommercialInput, "active" | "archivedAt">,
): boolean {
  return product.active && product.archivedAt === null;
}

/**
 * Rebuild the current, pre-acceptance terms for an existing request.
 *
 * A hidden or archived product must remain reviewable because it has request
 * history. Read callers may bypass only the publication gate; the canonical
 * Store builder still validates and computes every commercial field. Approval
 * and final acceptance independently enforce publication again.
 */
export function buildPurchaseRequestCommercialProposal(input: {
  requestedSongQty: number | null;
  product: StoreProductCommercialInput;
  taxMode: string;
  taxRatePct: number;
  allowUnpublished?: boolean;
}): PurchaseRequestCommercialProposal {
  const initialPlan = input.product.paymentPlans[0];
  if (!initialPlan) {
    throw new StoreProductCommercialError(
      "INVALID_PAYMENT_PLANS",
      "At least one payment plan must be enabled.",
      "paymentPlans",
    );
  }

  const { snapshot } = buildStorePurchaseSnapshot({
    product: input.allowUnpublished
      ? {
          ...input.product,
          active: true,
          archivedAt: null,
        }
      : input.product,
    requestedSongQty: input.requestedSongQty,
    taxMode: input.taxMode,
    taxRatePct: input.taxRatePct,
    selectedPaymentPlan: initialPlan,
  });

  return Object.freeze({
    ...snapshot,
    agreementText: buildStorePurchaseProposalAgreementText(snapshot, input.product),
    selectedPaymentPlan: null,
  });
}

/** Preserve an existing request row when legacy Store data cannot be rebuilt. */
export function tryBuildPurchaseRequestCommercialProposal(
  input: Parameters<typeof buildPurchaseRequestCommercialProposal>[0],
): PurchaseRequestCommercialProposal | null {
  try {
    return buildPurchaseRequestCommercialProposal(input);
  } catch (error) {
    if (error instanceof StoreProductCommercialError) return null;
    throw error;
  }
}
