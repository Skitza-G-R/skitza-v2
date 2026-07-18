import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import { isSafeAgreementUrl } from "~/lib/agreement-url";

export interface PaymentSelectionDraft {
  full: boolean;
  split50: boolean;
  monthly: boolean;
  monthlyInstallments: number;
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
export type AgreementMode = "none" | "link" | "text";
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
  contractUrl: string,
  agreementText: string,
): string | null {
  if (mode === "link") {
    const trimmed = contractUrl.trim();
    if (!trimmed) return "Enter a public agreement link or choose no attachment.";
    if (trimmed.length > 2048 || !isSafeAgreementUrl(trimmed)) {
      return "Use a valid http:// or https:// agreement link.";
    }
  }
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
