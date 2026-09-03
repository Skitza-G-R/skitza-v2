import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import type { SimulationInput } from "~/components/onboarding/first-artist-simulation/simulation-model";
import { coerceTaxMode } from "~/lib/tax-mode";

// Maps the producer's first live product onto the "Watch your first artist"
// simulation (SK-298). Pure so the completion page stays a thin loader and the
// mapping can be tested without a database.

export interface CompletionProductRow {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  pricingModel: string;
  volumeTiers: { minQty: number; pricePerUnitCents: number }[] | null;
  durationMin: number;
  sessionCount: number;
  deliverables: string[] | null;
  paymentPlans: PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
}

export interface CompletionProfile {
  displayName: string | null;
  taxMode: unknown;
  taxRatePct: number | null;
  logoUrl: string | null;
  /** The studio's IANA time zone; the simulated session is booked in it. */
  timezone: string | null;
}

/** Producers always carry a zone, but the column is nullable in older rows. */
const DEFAULT_TIMEZONE = "Asia/Jerusalem";

export interface CompletionPaymentInstructions {
  bankTransfer?: string | undefined;
  bitPhone?: string | undefined;
  note?: string | undefined;
}

const DEFAULT_TAX_RATE_PCT = 18;

export function clampTaxRatePct(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : DEFAULT_TAX_RATE_PCT;
}

export function toSimulationInput(input: {
  product: CompletionProductRow;
  profile: CompletionProfile;
  paymentInstructions: CompletionPaymentInstructions | null;
}): SimulationInput {
  const { product, profile, paymentInstructions } = input;
  const decoded = decodeDescription(product.description);
  const hasInstructions =
    paymentInstructions !== null &&
    Boolean(paymentInstructions.bankTransfer?.trim() || paymentInstructions.bitPhone?.trim());

  return {
    producerName: profile.displayName ?? "Your studio",
    producerLogoUrl: profile.logoUrl,
    timezone: profile.timezone?.trim() ? profile.timezone : DEFAULT_TIMEZONE,
    product: {
      id: product.id,
      name: product.name,
      tagline: decoded.tagline,
      priceCents: product.priceCents,
      currency: product.currency,
      pricingModel: product.pricingModel === "per_song" ? "per_song" : "flat",
      volumeTiers: product.volumeTiers ?? [],
      durationMin: product.durationMin,
      sessionCount: product.sessionCount,
      deliverables: product.deliverables ?? [],
      revisions: decoded.revisions,
      unlimitedRevisions: decoded.unlimitedRevisions,
      paymentPlans: product.paymentPlans,
      royaltyTerms: product.royaltyTerms,
      agreementText: product.agreementText ?? decoded.contractText,
    },
    taxMode: coerceTaxMode(profile.taxMode),
    taxRatePct: clampTaxRatePct(profile.taxRatePct),
    paymentDetails: hasInstructions
      ? {
          bankTransfer: paymentInstructions.bankTransfer,
          bitPhone: paymentInstructions.bitPhone,
          note: paymentInstructions.note,
        }
      : null,
  };
}
