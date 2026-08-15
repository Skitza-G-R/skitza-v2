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
  agreementPdf?:
    | Readonly<{
        documentId: string;
        originalFileName: string;
        sizeBytes: number;
      }>
    | null
    | undefined;
  /** True when required private rights cannot be copied canonically. */
  rightsNeedCompletion: boolean;
  /** True when a legacy agreement link must be replaced or explicitly removed. */
  agreementNeedsCompletion: boolean;
}>;
