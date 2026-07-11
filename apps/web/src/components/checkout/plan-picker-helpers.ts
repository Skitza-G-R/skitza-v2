import type { PaymentPlan } from "@skitza/db";

// Stable string key for a PaymentPlan variant — used both as the form
// value and the React key. `monthly` variants fold their installments
// into the key so two monthly options (e.g. 3× vs. 6×) are distinct.
export function planKey(p: PaymentPlan): string {
  if (p.kind === "monthly") return `monthly_${String(p.installments)}`;
  return p.kind;
}

// Human-readable label for the radio option. Splits cents so the user
// sees the same breakdown calculateCharges produces server-side (any
// remainder on the first charge), keeping the UI honest about what the
// card will be charged.
export function planLabel(
  p: PaymentPlan,
  total: number,
  format: (c: number) => string,
): string {
  if (p.kind === "full") return `Pay in full — ${format(total)} today`;
  if (p.kind === "split_50_50") {
    // calculateCharges puts the remainder on the FIRST charge (see
    // apps/web/src/server/payments/plan.ts). Match that here so the
    // label matches the actual first Stripe charge on odd-cent totals.
    const half = Math.floor(total / 2) + (total % 2);
    return `50/50 — ${format(half)} now, ${format(total - half)} on delivery`;
  }
  if (p.kind === "milestones") {
    // Exact-terms surfaces reuse this formatter, so retain the complete
    // frozen schedule rather than reducing it to the first milestone.
    const schedule = p.milestones
      .map((milestone) => `${milestone.label} ${String(milestone.pct)}%`)
      .join(" · ");
    return schedule ? `Milestones — ${schedule}` : "Milestones";
  }
  // calculateCharges puts the remainder on the FIRST charge (see
  // apps/web/src/server/payments/plan.ts). Mirror that here so the
  // label matches the actual charge sequence on odd-cent totals —
  // e.g. $100.03 / 3 → [33.35, 33.34, 33.34], not a uniform "$33/mo".
  const base = Math.floor(total / p.installments);
  const first = base + (total - base * p.installments);
  return `Monthly — ${format(first)} today, then ${format(base)}/month for ${String(p.installments - 1)} months`;
}

/**
 * Exact schedule copy for request/agreement surfaces where no payment is due
 * yet. Keep checkout's "today/now" language in planLabel(), and use this
 * formatter before approval or when displaying an immutable request snapshot.
 */
export function requestPlanLabel(
  p: PaymentPlan,
  total: number,
  format: (c: number) => string,
): string {
  if (p.kind === "full") {
    return `Pay in full — ${format(total)} after approval`;
  }
  if (p.kind === "split_50_50") {
    const second = Math.floor(total / 2);
    const first = total - second;
    return `50/50 — ${format(first)} first after approval, ${format(second)} on delivery`;
  }
  if (p.kind === "milestones") {
    const schedule = p.milestones
      .map((milestone) => `${milestone.label} ${String(milestone.pct)}%`)
      .join(" · ");
    return schedule ? `Milestones — ${schedule}` : "Milestones";
  }
  const later = Math.floor(total / p.installments);
  const first = total - later * (p.installments - 1);
  return `Monthly — ${String(p.installments)} payments; ${format(first)} first after approval, then ${format(later)} monthly`;
}
