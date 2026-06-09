import { randomBytes } from "node:crypto";

import type { PaymentPlan } from "@skitza/db";

// Pure helpers for the purchase request mutation (SK-37 / BE-1). Kept
// dependency-free (no tRPC / next / React-Email imports) so they're
// trivially unit-testable in isolation.

// A chosen plan is valid only if the product actually offers it (same
// kind; for monthly, same installment count). Mirrors the "unlisted
// plan" guard inside initiatePaidPlanCheckout.
export function planIsOffered(
  chosen: PaymentPlan,
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
