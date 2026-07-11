import { createHash } from "node:crypto";
import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

export type CommercialTermsFingerprintInput = {
  productName: string;
  priceCents: number;
  currency: string;
  paymentPlans: PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
  contractUrl: string | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function commercialTermsFingerprint(
  input: CommercialTermsFingerprintInput,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}
