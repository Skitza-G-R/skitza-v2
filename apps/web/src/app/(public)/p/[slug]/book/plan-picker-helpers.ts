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
  const each = Math.floor(total / p.installments);
  return `Monthly — ${format(each)} today, then ${format(each)}/month for ${String(p.installments - 1)} months`;
}
