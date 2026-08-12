import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import type { PrivateOfferTemplateProduct } from "~/components/dashboard/offers/private-offer-template-types";
import type { TaxMode } from "~/lib/tax-mode";
import { deriveStoreProductRights } from "~/server/domain/store-products/service";

import { decodeDescription } from "./description-encoding";

export type PrivateOfferTemplateSource = Readonly<{
  id: string;
  name: string;
  description: string | null;
  kind: string;
  priceCents: number;
  hourlyRateCents: number | null;
  currency: string;
  durationMin: number;
  sessionCount: number;
  bookingEnabled: boolean;
  paymentPlans: readonly PaymentPlan[];
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  agreementPdf: { documentId: string } | null;
  legacyAgreementLinkPresent: boolean;
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
  deliverables: readonly string[] | null;
  pricingModel: string;
  volumeTiers:
    | readonly Readonly<{
        minQty: number;
        pricePerUnitCents: number;
      }>[]
    | null;
}>;

function templateCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

/**
 * Copies canonical raw product fields into the editable private-offer shape.
 * In particular, priceCents remains the pre-tax subtotal; the Store card may
 * display a tax-added amount and must never be used as the template source.
 */
export function buildPrivateOfferTemplateProduct(
  product: PrivateOfferTemplateSource,
  input: {
    taxMode: TaxMode;
    taxRatePct: number;
  },
): PrivateOfferTemplateProduct {
  const decoded = decodeDescription(product.description);
  const perSong = product.pricingModel === "per_song";
  const hourly = product.pricingModel === "hourly";
  const firstTier = product.volumeTiers?.find((tier) => tier.minQty === 1);
  const cashPriceCents = perSong
    ? (firstTier?.pricePerUnitCents ?? product.priceCents)
    : hourly
      ? (product.hourlyRateCents ?? 0)
      : product.priceCents;
  const agreementText = (product.agreementText ?? decoded.contractText).trim();
  const royaltyTerms = product.royaltyTerms
    ? {
        ...product.royaltyTerms,
        master: { ...product.royaltyTerms.master },
        composition: { ...product.royaltyTerms.composition },
      }
    : null;
  // Products created before structured commercial rights existed have no
  // canonical rights to copy. An explicit "not specified" sentence would be
  // invented private-offer language, so leave this empty and require the
  // producer to complete the missing terms before review.
  const rights = royaltyTerms ? deriveStoreProductRights(royaltyTerms) : [];
  const includedSongSpaces = perSong
    ? 1
    : product.pricingModel === "hourly" || product.kind === "session" || product.kind === "hourly"
      ? 0
      : 1;

  return {
    source: {
      productId: product.id,
      productName: product.name,
      productKind: product.kind,
    },
    terms: {
      name: product.name,
      ...(decoded.tagline.trim() ? { tagline: decoded.tagline.trim() } : {}),
      service: product.kind,
      deliverables: [...(product.deliverables ?? [])],
      cashPriceCents,
      currency: templateCurrency(product.currency),
      taxMode: input.taxMode,
      taxRatePct: input.taxRatePct,
      includedSongSpaces,
      session: product.bookingEnabled
        ? {
            limit:
              product.sessionCount === 0
                ? { kind: "unlimited" }
                : { kind: "fixed", count: product.sessionCount },
            durationMin: product.durationMin,
            locationType: product.locationType,
            bufferMinutes: product.bufferMinutes,
            minLeadHours: product.minLeadHours,
          }
        : null,
      revisionRule: decoded.unlimitedRevisions
        ? { kind: "unlimited" }
        : { kind: "fixed", count: decoded.revisions },
      royaltyTerms,
      rights,
      enabledPaymentPlans: product.paymentPlans.map((plan) => ({ ...plan })),
      agreementText,
    },
    pricing: perSong
      ? {
          kind: "per_song",
          initialQuantity: 1,
          volumeTiers: (product.volumeTiers ?? []).map((tier) => ({ ...tier })),
        }
      : hourly
        ? { kind: "hourly", hourlyRateCents: product.hourlyRateCents ?? 0 }
        : { kind: "fixed" },
    agreementNeedsCompletion: agreementText.length === 0 || rights.length === 0,
  };
}
