import type { PaymentPlan } from "@skitza/db";

import { calculateCharges } from "./plan";

// Pure BE-2 plan math shared by artist.purchase.paymentPlan.* and the
// payment-instructions/proof screens. Dependency-free beyond
// calculateCharges so every branch is unit-testable.

export type PlanOption = {
  kind: PaymentPlan["kind"];
  /** monthly only — total number of charges */
  installments?: number;
  /** per-charge minor units, in payment order; sums exactly to total */
  charges: number[];
  /** first charge — the "due today" figure on S7 cards */
  dueNowCents: number;
  /** one human label per charge (en-only v1) */
  labels: string[];
};

function labelsFor(plan: PaymentPlan, charges: number[]): string[] {
  switch (plan.kind) {
    case "full":
      return ["Due today"];
    case "split_50_50":
      return ["Due today", "On delivery"];
    case "monthly":
      return charges.map((_, i) => (i === 0 ? "Due today" : `Month ${String(i + 1)}`));
    case "milestones":
      return plan.milestones.map((m) => m.label);
  }
}

export function planOption(plan: PaymentPlan, totalCents: number): PlanOption {
  const charges = calculateCharges(plan, totalCents);
  return {
    kind: plan.kind,
    ...(plan.kind === "monthly" ? { installments: plan.installments } : {}),
    charges,
    dueNowCents: charges[0] ?? totalCents,
    labels: labelsFor(plan, charges),
  };
}

export function buildPlanOptions(offered: PaymentPlan[], totalCents: number): PlanOption[] {
  return offered.map((p) => planOption(p, totalCents));
}

// Progress of an off-app payment against a charge schedule. Proof
// amounts don't have to align 1:1 with charges — we walk the schedule
// cumulatively, so a ₪1,500 payment against [1200, 1200] completes the
// first charge and part-covers the second.
export function chargesProgress(
  charges: number[],
  paidCents: number,
): {
  chargesCompleted: number;
  remainingCents: number;
  /** the amount that finishes the CURRENT charge (null once fully paid) */
  nextDueCents: number | null;
} {
  const total = charges.reduce((a, b) => a + b, 0);
  const paid = Math.max(0, paidCents);
  const remaining = Math.max(0, total - paid);

  let cumulative = 0;
  let completed = 0;
  for (const c of charges) {
    if (paid >= cumulative + c) {
      completed += 1;
      cumulative += c;
    } else {
      break;
    }
  }
  if (remaining === 0) {
    return {
      chargesCompleted: charges.length,
      remainingCents: 0,
      nextDueCents: null,
    };
  }
  const coveredIntoNext = paid - cumulative;
  const nextCharge = charges[completed] ?? remaining;
  return {
    chargesCompleted: completed,
    remainingCents: remaining,
    nextDueCents: Math.min(nextCharge - coveredIntoNext, remaining),
  };
}

// The `invoices.kind` free-text role for the Nth charge of a plan.
export function invoiceKindForCharge(
  planKind: PaymentPlan["kind"],
  chargeIndex: number,
  chargeCount: number,
): "full" | "deposit" | "milestone" | "final" {
  if (planKind === "full" || chargeCount <= 1) return "full";
  if (chargeIndex <= 0) return "deposit";
  if (chargeIndex >= chargeCount - 1) return "final";
  return "milestone";
}
