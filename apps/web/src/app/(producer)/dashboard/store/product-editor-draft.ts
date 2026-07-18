import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import type { VolumeTier } from "~/lib/pricing";

export const MAX_PRODUCT_TAGLINE_LENGTH = 160;

export function productTaglineError(tagline: string): string | null {
  const trimmed = tagline.trim();
  if (!trimmed) return "Write the short tagline artists will see.";
  if (trimmed.length > MAX_PRODUCT_TAGLINE_LENGTH) {
    return `Tagline must be ${String(MAX_PRODUCT_TAGLINE_LENGTH)} characters or fewer.`;
  }
  if (/\r|\n/.test(trimmed)) return "Keep the tagline to one line.";
  return null;
}

export function productCashPriceError(input: {
  price: number;
  pricingModel: "flat" | "per_song";
  volumeTiers: readonly VolumeTier[];
}): string | null {
  const priceCents = Math.round(input.price * 100);
  if (
    !Number.isFinite(input.price) ||
    !Number.isSafeInteger(priceCents) ||
    priceCents <= 0
  ) {
    return "Enter a cash price above 0. Zero-price and royalty-only deals belong in private offers.";
  }
  if (input.pricingModel === "flat") return null;
  if (input.volumeTiers.length === 0 || input.volumeTiers.length > 10) {
    return "Per-song pricing needs between 1 and 10 price tiers.";
  }
  if (!input.volumeTiers.some((tier) => tier.minQty === 1)) {
    return "Add a starting price for one song.";
  }
  if (
    input.volumeTiers.some(
      (tier) =>
        !Number.isSafeInteger(tier.minQty) || tier.minQty < 1 || tier.minQty > 1_000,
    )
  ) {
    return "Every per-song threshold must be a whole number from 1 to 1,000.";
  }
  if (
    input.volumeTiers.some(
      (tier) => !Number.isSafeInteger(tier.pricePerUnitCents) || tier.pricePerUnitCents <= 0,
    )
  ) {
    return "Every per-song tier needs a cash price above 0.";
  }

  const sorted = [...input.volumeTiers].sort((left, right) => left.minQty - right.minQty);
  if (sorted[0]?.pricePerUnitCents !== priceCents) {
    return "The one-song tier must match the product's starting price.";
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    if (current.minQty === previous.minQty) {
      return "Every per-song threshold must be unique.";
    }
    if (current.pricePerUnitCents > previous.pricePerUnitCents) {
      return "A higher-volume tier cannot cost more per song than the tier before it.";
    }
  }
  return null;
}

export interface PaymentSelectionDraft {
  full: boolean;
  split50: boolean;
  monthly: boolean;
  monthlyInstallments: number;
}

/**
 * Mirrors the published-product feasibility rule in the Store domain: even
 * the cheapest valid purchase subtotal must leave at least one cent in every
 * installment of every enabled plan. Tax is intentionally excluded because
 * the immutable commercial service validates the pre-tax subtotal.
 */
export function paymentPlanFeasibilityError(input: {
  price: number;
  pricingModel: "flat" | "per_song";
  volumeTiers: readonly VolumeTier[];
  payment: PaymentSelectionDraft;
}): string | null {
  const maximumInstallments = Math.max(
    1,
    input.payment.split50 ? 2 : 1,
    input.payment.monthly &&
      Number.isSafeInteger(input.payment.monthlyInstallments) &&
      input.payment.monthlyInstallments >= 2 &&
      input.payment.monthlyInstallments <= 12
      ? input.payment.monthlyInstallments
      : 1,
  );

  let minimumSubtotalCents: bigint;
  if (input.pricingModel === "per_song") {
    const validOpenings = input.volumeTiers.flatMap((tier) =>
      Number.isSafeInteger(tier.minQty) &&
      tier.minQty >= 1 &&
      Number.isSafeInteger(tier.pricePerUnitCents) &&
      tier.pricePerUnitCents > 0
        ? [BigInt(tier.minQty) * BigInt(tier.pricePerUnitCents)]
        : [],
    );
    if (validOpenings.length !== input.volumeTiers.length || validOpenings.length === 0) {
      return null;
    }
    minimumSubtotalCents = validOpenings.reduce((minimum, opening) =>
      opening < minimum ? opening : minimum,
    );
  } else {
    const priceCents = Math.round(input.price * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return null;
    minimumSubtotalCents = BigInt(priceCents);
  }

  if (minimumSubtotalCents < BigInt(maximumInstallments)) {
    return "Increase the minimum purchase price or reduce the enabled installments so every payment is at least 1 cent.";
  }
  return null;
}

export function seedPaymentSelection(
  plans: readonly PaymentPlan[] | null | undefined,
): PaymentSelectionDraft {
  const saved = plans ?? [];
  const monthly = saved.find((plan) => plan.kind === "monthly");

  return {
    full: saved.some((plan) => plan.kind === "full"),
    split50: saved.some((plan) => plan.kind === "split_50_50"),
    monthly: monthly !== undefined,
    monthlyInstallments:
      monthly?.kind === "monthly" ? monthly.installments : 4,
  };
}

export function buildPaymentPlans(
  selection: PaymentSelectionDraft,
): PaymentPlan[] {
  if (
    selection.monthly &&
    (!Number.isInteger(selection.monthlyInstallments) ||
      selection.monthlyInstallments < 2 ||
      selection.monthlyInstallments > 12)
  ) {
    throw new Error("Monthly payments must be between 2 and 12.");
  }

  const plans: PaymentPlan[] = [];
  if (selection.full) plans.push({ kind: "full" });
  if (selection.split50) plans.push({ kind: "split_50_50" });
  if (selection.monthly) {
    plans.push({
      kind: "monthly",
      installments: selection.monthlyInstallments,
    });
  }

  return plans;
}

export function hasPaymentOption(selection: PaymentSelectionDraft): boolean {
  return selection.full || selection.split50 || selection.monthly;
}

export type RoyaltyMode = "none" | "percentage" | "agreement";
export type AgreementMode = "none" | "text";
export type CompositionRole =
  | "composer"
  | "lyricist"
  | "arranger"
  | "publisher"
  | "other";

export interface ProductRoyaltyDraft {
  masterMode: RoyaltyMode | null;
  masterPercentage: string;
  compositionMode: RoyaltyMode | null;
  compositionPercentage: string;
  compositionRole: CompositionRole | "";
  collectingSociety: string;
  notes: string;
}

export type RoyaltyDraftErrors = {
  master?: string;
  composition?: string;
  notes?: string;
};

export function validateAgreementDraft(
  mode: AgreementMode,
  agreementText: string,
): string | null {
  if (mode === "text") {
    if (!agreementText.trim()) {
      return "Write the agreement terms or choose no attachment.";
    }
    if (agreementText.length > 20_000) {
      return "Agreement text must be 20,000 characters or fewer.";
    }
  }
  return null;
}

export function seedStoreAgreementDraft(
  agreementText: string,
  legacyContractUrl: string | null | undefined,
): {
  agreementMode: AgreementMode;
  agreementText: string;
  requiresLegacyLinkReplacement: boolean;
} {
  const hasInlineTerms = Boolean(agreementText.trim());
  const requiresLegacyLinkReplacement =
    !hasInlineTerms && Boolean(legacyContractUrl?.trim());

  return {
    agreementMode:
      hasInlineTerms || requiresLegacyLinkReplacement ? "text" : "none",
    agreementText,
    requiresLegacyLinkReplacement,
  };
}

/**
 * Converts a percentage string to integer basis points without floating-point
 * multiplication. The product model stores hundredths of one percent, so
 * values with more than two decimal places are intentionally rejected.
 */
export function percentageStringToBps(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(trimmed)) {
    return null;
  }

  const [wholePart = "", decimalPart = ""] = trimmed.split(".");
  const whole = Number.parseInt(wholePart || "0", 10);
  const hundredths = Number.parseInt(decimalPart.padEnd(2, "0") || "0", 10);
  const bps = whole * 100 + hundredths;
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

export function bpsToPercentageString(bps: number): string {
  const safe = Math.max(0, Math.min(10_000, Math.round(bps)));
  const whole = Math.floor(safe / 100);
  const hundredths = safe % 100;
  if (hundredths === 0) return String(whole);
  if (hundredths % 10 === 0) return `${String(whole)}.${String(hundredths / 10)}`;
  return `${String(whole)}.${String(hundredths).padStart(2, "0")}`;
}

export function royaltyTermsToDraft(
  terms: ProductRoyaltyTerms | null | undefined,
): ProductRoyaltyDraft {
  if (!terms) {
    return {
      masterMode: null,
      masterPercentage: "",
      compositionMode: null,
      compositionPercentage: "",
      compositionRole: "",
      collectingSociety: "",
      notes: "",
    };
  }

  return {
    masterMode: terms.master.mode,
    masterPercentage:
      terms.master.mode === "percentage"
        ? bpsToPercentageString(terms.master.bps)
        : "",
    compositionMode: terms.composition.mode,
    compositionPercentage:
      terms.composition.mode === "percentage"
        ? bpsToPercentageString(terms.composition.bps)
        : "",
    compositionRole:
      terms.composition.mode === "percentage"
        ? (terms.composition.role ?? "")
        : "",
    collectingSociety:
      terms.composition.mode === "percentage"
        ? (terms.composition.collectingSociety ?? "")
        : "",
    notes: terms.notes ?? "",
  };
}

export function validateRoyaltyDraft(
  draft: ProductRoyaltyDraft,
  requireExplicit: boolean,
): RoyaltyDraftErrors {
  const errors: RoyaltyDraftErrors = {};
  const untouched =
    draft.masterMode === null &&
    draft.compositionMode === null &&
    !draft.masterPercentage.trim() &&
    !draft.compositionPercentage.trim() &&
    !draft.compositionRole &&
    !draft.collectingSociety.trim() &&
    !draft.notes.trim();
  if (untouched && !requireExplicit) return errors;

  if (draft.masterMode === null) {
    errors.master = "Choose a master-rights option.";
  } else if (
    draft.masterMode === "percentage" &&
    percentageStringToBps(draft.masterPercentage) === null
  ) {
    errors.master = "Enter a percentage from 0.01% to 100%.";
  }

  if (draft.compositionMode === null) {
    errors.composition = "Choose a composition-rights option.";
  } else if (
    draft.compositionMode === "percentage" &&
    percentageStringToBps(draft.compositionPercentage) === null
  ) {
    errors.composition = "Enter a percentage from 0.01% to 100%.";
  } else if (
    draft.compositionMode === "percentage" &&
    draft.collectingSociety.length > 200
  ) {
    errors.composition = "Collecting society must be 200 characters or fewer.";
  }

  if (draft.notes.length > 4_000) {
    errors.notes = "Rights notes must be 4,000 characters or fewer.";
  }

  return errors;
}

export function royaltyDraftToTerms(
  draft: ProductRoyaltyDraft,
): ProductRoyaltyTerms | null {
  if (draft.masterMode === null || draft.compositionMode === null) return null;

  const master: ProductRoyaltyTerms["master"] =
    draft.masterMode === "percentage"
      ? {
          mode: "percentage",
          bps: percentageStringToBps(draft.masterPercentage) ?? 0,
        }
      : { mode: draft.masterMode };

  const composition: ProductRoyaltyTerms["composition"] =
    draft.compositionMode === "percentage"
      ? {
          mode: "percentage",
          bps: percentageStringToBps(draft.compositionPercentage) ?? 0,
          ...(draft.compositionRole
            ? { role: draft.compositionRole }
            : {}),
          ...(draft.collectingSociety.trim()
            ? { collectingSociety: draft.collectingSociety.trim() }
            : {}),
        }
      : { mode: draft.compositionMode };

  const notes = draft.notes.trim();
  return {
    master,
    composition,
    ...(notes ? { notes } : {}),
  };
}
