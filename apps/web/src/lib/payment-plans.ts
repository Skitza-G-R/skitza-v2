import type { PaymentPlan } from "@skitza/db";

import { calculateCharges } from "~/server/payments/plan";

export type SupportedStandardPaymentPlan = PaymentPlan;

/**
 * Canonical product storage order for authored plans.
 */
export function normalizeProductPaymentPlans(plans: PaymentPlan[]): PaymentPlan[] {
  const full = plans.find((plan) => plan.kind === "full");
  const split = plans.find((plan) => plan.kind === "split_50_50");
  const monthly = plans.find((plan) => plan.kind === "monthly");

  return [
    ...(full ? [full] : []),
    ...(split ? [split] : []),
    ...(monthly ? [monthly] : []),
  ];
}

/**
 * Apply the product editor's complete authored selection. The existing
 * argument remains part of the current caller contract but no longer carries
 * plan variants forward after they are removed from the editor.
 */
export function mergePreservedPaymentPlans(
  incoming: PaymentPlan[],
  existing: PaymentPlan[] | null | undefined,
): PaymentPlan[] {
  void existing;
  return normalizeProductPaymentPlans(incoming);
}

/**
 * Explicit fallback for calendar flows that have no plan picker: pay in full
 * when offered, otherwise the first offered plan. Empty rows fail safe to pay
 * in full.
 */
export function selectFallbackPaymentPlan(
  plans: PaymentPlan[] | null | undefined,
): SupportedStandardPaymentPlan {
  const offered = plans ?? [];
  return offered.find((plan) => plan.kind === "full") ?? offered[0] ?? { kind: "full" };
}

export type ProvisionalRequestPaymentPlan = PaymentPlan;

/**
 * Purchase requests make their real choice after approval, but need a valid
 * provisional offered value at request time.
 */
export function selectProvisionalRequestPaymentPlan(
  offered: PaymentPlan[],
): ProvisionalRequestPaymentPlan | null {
  const full = offered.find((plan) => plan.kind === "full");
  const [firstOffered] = offered;
  const selected = full ?? firstOffered;
  if (!selected) return null;
  return selected;
}

export type CalendarPaymentSummary = {
  selectedPlan: SupportedStandardPaymentPlan;
  planKind: SupportedStandardPaymentPlan["kind"];
  amountCents: number;
  // Existing artist-home compatibility value.
  plan: "50-50" | "monthly" | "upfront";
  // Clear copy for new/updated calendar summaries.
  planLabel: string;
};

export function calendarPaymentSummary(
  totalCents: number,
  plans: PaymentPlan[] | null | undefined,
): CalendarPaymentSummary {
  const selectedPlan = selectFallbackPaymentPlan(plans);
  const amountCents =
    totalCents > 0 ? (calculateCharges(selectedPlan, totalCents)[0] ?? totalCents) : totalCents;

  if (selectedPlan.kind === "split_50_50") {
    return {
      selectedPlan,
      planKind: selectedPlan.kind,
      amountCents,
      plan: "50-50",
      planLabel: "50% now, 50% on delivery",
    };
  }
  if (selectedPlan.kind === "monthly") {
    return {
      selectedPlan,
      planKind: selectedPlan.kind,
      amountCents,
      plan: "monthly",
      planLabel: `${String(selectedPlan.installments)} monthly payments`,
    };
  }
  return {
    selectedPlan,
    planKind: selectedPlan.kind,
    amountCents,
    plan: "upfront",
    planLabel: "Pay in full",
  };
}
