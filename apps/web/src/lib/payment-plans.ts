import type { PaymentPlan } from "@skitza/db";

import { calculateCharges } from "~/server/payments/plan";

export type SupportedStandardPaymentPlan = Exclude<PaymentPlan, { kind: "milestones" }>;

export function isSupportedStandardPaymentPlan(
  plan: PaymentPlan,
): plan is SupportedStandardPaymentPlan {
  return plan.kind === "full" || plan.kind === "split_50_50" || plan.kind === "monthly";
}

/**
 * Canonical product storage order for authored standard plans. Milestone
 * values are compatibility data: keep their relative order after the three
 * standard slots, while `offeredPlans()` continues deriving the one virtual
 * milestone choice from products.milestones.
 */
export function normalizeProductPaymentPlans(plans: PaymentPlan[]): PaymentPlan[] {
  const full = plans.find((plan) => plan.kind === "full");
  const split = plans.find((plan) => plan.kind === "split_50_50");
  const monthly = plans.find((plan) => plan.kind === "monthly");
  const preserved = plans.filter((plan) => !isSupportedStandardPaymentPlan(plan));

  return [
    ...(full ? [full] : []),
    ...(split ? [split] : []),
    ...(monthly ? [monthly] : []),
    ...preserved,
  ];
}

/**
 * Product-editor updates own only the standard choices. Preserve legacy or
 * virtual-plan-shaped values already on the row, and de-duplicate an editor
 * round-trip that included the same compatibility value.
 */
export function mergePreservedPaymentPlans(
  incoming: PaymentPlan[],
  existing: PaymentPlan[] | null | undefined,
): PaymentPlan[] {
  const standards = normalizeProductPaymentPlans(incoming).filter(isSupportedStandardPaymentPlan);
  const compatibility = [
    ...(existing ?? []).filter((plan) => !isSupportedStandardPaymentPlan(plan)),
    ...incoming.filter((plan) => !isSupportedStandardPaymentPlan(plan)),
  ];
  const seen = new Set<string>();
  const preserved = compatibility.filter((plan) => {
    const key = JSON.stringify(plan);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...standards, ...preserved];
}

/**
 * Explicit fallback for calendar flows that have no plan picker: pay in full
 * when offered, otherwise the first supported standard plan. Malformed or
 * milestone-only legacy rows fail safe to pay in full.
 */
export function selectFallbackPaymentPlan(
  plans: PaymentPlan[] | null | undefined,
): SupportedStandardPaymentPlan {
  const supported = (plans ?? []).filter(isSupportedStandardPaymentPlan);
  return supported.find((plan) => plan.kind === "full") ?? supported[0] ?? { kind: "full" };
}

export type ProvisionalRequestPaymentPlan = SupportedStandardPaymentPlan | { kind: "milestones" };

/**
 * Purchase requests make their real choice after approval, but need a valid
 * provisional offered value at request time. Unlike the calendar fallback,
 * milestone plans are supported here and must never be replaced by a
 * synthetic, unoffered full plan.
 */
export function selectProvisionalRequestPaymentPlan(
  offered: PaymentPlan[],
): ProvisionalRequestPaymentPlan | null {
  const full = offered.find((plan) => plan.kind === "full");
  const [firstOffered] = offered;
  const selected = full ?? firstOffered;
  if (!selected) return null;
  return selected.kind === "milestones" ? { kind: "milestones" } : selected;
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
