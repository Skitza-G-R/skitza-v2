import type { PaymentPlan } from "@skitza/db";

// Extracts the producer's plan selections from the product-form
// FormData. Called from the server action. Always returns at least
// [{kind:'full'}] so no product can end up with an empty plan list —
// that would make it unpurchasable.
export function parsePaymentPlansFromFormData(fd: FormData): PaymentPlan[] {
  const plans: PaymentPlan[] = [];
  if (fd.get("plan_full") === "on") plans.push({ kind: "full" });
  if (fd.get("plan_split") === "on") plans.push({ kind: "split_50_50" });
  if (fd.get("plan_monthly") === "on") {
    const raw = fd.get("plan_monthly_n");
    const n = Number.parseInt(typeof raw === "string" ? raw : "", 10);
    const installments = Number.isInteger(n)
      ? Math.max(2, Math.min(12, n))
      : 4;
    plans.push({ kind: "monthly", installments });
  }
  return plans.length > 0 ? plans : [{ kind: "full" }];
}
