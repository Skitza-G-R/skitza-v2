import { createHash } from "node:crypto";

/**
 * Stable digest used by Chat 14 when proof confirmation first shipped.
 * Keeping this exact shape lets the generic ledger replay already-confirmed
 * proofs without rewriting append-only purchase payment history.
 */
export function proofPaymentOperationDigest(input: {
  proofId: string;
  purchaseId: string;
  installmentId: string;
  amountCents: number;
  currency: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        source: "proof",
        proofId: input.proofId,
        purchaseId: input.purchaseId,
        installmentId: input.installmentId,
        amountCents: input.amountCents,
        currency: input.currency,
      }),
    )
    .digest("hex");
}
