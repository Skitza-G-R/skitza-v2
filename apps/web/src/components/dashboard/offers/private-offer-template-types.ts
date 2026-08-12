import type { PrivateOfferInput } from "~/server/domain/private-offers/service";

export type PrivateOfferTemplatePricing =
  | Readonly<{ kind: "fixed" }>
  | Readonly<{
      kind: "hourly";
      /** Context only. A private offer still requires an explicit fixed subtotal. */
      hourlyRateCents: number;
    }>
  | Readonly<{
      kind: "per_song";
      initialQuantity: 1;
      volumeTiers: readonly Readonly<{
        minQty: number;
        pricePerUnitCents: number;
      }>[];
    }>;

/** Canonical Store-product data copied into an independent private-offer draft. */
export type PrivateOfferTemplateProduct = Readonly<{
  source: Readonly<{
    productId: string;
    productName: string;
    productKind: string;
  }>;
  terms: PrivateOfferInput;
  pricing: PrivateOfferTemplatePricing;
  /** True when required private agreement or rights text cannot be copied canonically. */
  agreementNeedsCompletion: boolean;
}>;
