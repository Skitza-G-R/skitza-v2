import { randomBytes } from "node:crypto";

import type { PaymentPlan } from "@skitza/db";

// Pure helpers for the purchase request mutation (SK-37 / BE-1). Kept
// dependency-free (no tRPC / next / React-Email imports) so they're
// trivially unit-testable in isolation.

// A chosen plan is valid only if the product actually offers it (same
// kind; for monthly, same installment count). Mirrors the "unlisted
// plan" guard inside initiatePaidPlanCheckout.
export type PaymentPlanChoice =
  | { kind: "full" }
  | { kind: "split_50_50" }
  | { kind: "monthly"; installments: number }
  | { kind: "milestones" };

// The full set of plans a product offers: its paymentPlans array, plus a
// virtual milestones plan when the product's deposit model is milestone-
// based (the schedule lives in products.milestones, not paymentPlans).
// The milestones CHOICE carries no schedule — the server embeds the
// product's own rows at snapshot time so a tampered payload can't
// invent one (see PaymentPlanChoice above).
export function offeredPlans(product: {
  paymentPlans: PaymentPlan[] | null;
  depositModel: string;
  milestones: { label: string; pct: number }[] | null;
}): PaymentPlan[] {
  const plans: PaymentPlan[] = [...(product.paymentPlans ?? [])].filter(
    (p) => p.kind !== "milestones",
  );
  if (product.depositModel === "milestones" && product.milestones?.length) {
    plans.push({ kind: "milestones", milestones: product.milestones });
  }
  return plans;
}

export function planIsOffered(
  chosen: PaymentPlanChoice,
  offered: PaymentPlan[],
): boolean {
  return offered.some((p) => {
    if (p.kind !== chosen.kind) return false;
    if (p.kind === "monthly" && chosen.kind === "monthly") {
      return p.installments === chosen.installments;
    }
    return true;
  });
}

// Artist-facing reference, e.g. "SK-7F3QK2". 6 base36 chars ≈ 2.1B of
// space; the UNIQUE constraint on ref_number is the real collision
// guard (the insert retries on the rare clash).
export function generateRefNumber(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) {
    // charAt never returns undefined, so the result stays a string.
    code += alphabet.charAt(b % 36);
  }
  return `SK-${code}`;
}

// Recognises a postgres UNIQUE-violation across the shapes the neon
// driver surfaces: a `.code` of '23505' and/or a message mentioning the
// duplicate-key / unique-constraint text.
export function isUniqueViolation(err: unknown): boolean {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  ) {
    return true;
  }
  return /duplicate key|unique constraint|23505/i.test(String(err));
}
