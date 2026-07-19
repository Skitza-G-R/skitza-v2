import type { PaymentPlan } from "@skitza/db";

// Stable string key for a PaymentPlan variant — used both as the form
// value and the React key. `monthly` variants fold their installments
// into the key so two monthly options (e.g. 3× vs. 6×) are distinct.
export function planKey(p: PaymentPlan): string {
  if (p.kind === "monthly") return `monthly_${String(p.installments)}`;
  return p.kind;
}

/**
 * Exact schedule copy for request/agreement surfaces where no payment is due
 * yet. Use this formatter before approval or when displaying an immutable
 * request snapshot.
 */
export function requestPlanLabel(
  p: PaymentPlan,
  total: number,
  format: (c: number) => string,
): string {
  if (p.kind === "full") {
    return `Pay in full — ${format(total)} at acceptance`;
  }
  if (p.kind === "split_50_50") {
    const second = Math.floor(total / 2);
    const first = total - second;
    return `50/50 — ${format(first)} at acceptance, ${format(second)} when the artist approves the final version`;
  }
  const later = Math.floor(total / p.installments);
  const first = total - later * (p.installments - 1);
  return `Monthly — ${String(p.installments)} payments; ${format(first)} at acceptance, then ${format(later)} monthly`;
}
