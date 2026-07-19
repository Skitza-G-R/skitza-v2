// Types + display helpers for the artist purchase flow (Commit section).
//
// The shapes mirror BE-1's contract (SK-37): the route pages fetch the real
// product + producer via tRPC (`artist.store.product`), map them with
// `~/lib/purchase/product-mapping`, and pass these shapes down — the screens
// stay data-only.

import type {
  PaymentPlan,
  ProductRoyaltyTerms,
  PurchaseCommercialSnapshot,
} from "@skitza/db";

import type { VolumeTier } from "~/lib/pricing";

export type PurchaseProduct = {
  id: string;
  name: string;
  /** Price-locked snapshot in the currency's minor unit. */
  priceCents: number;
  currency: string;
  /** Human duration label, e.g. "3 sessions · 2h each". */
  durationLabel: string;
  /** What the booking covers — the agreement's "What's included" list. */
  includes: string[];
  /** Wizard tagline (decoded from description) — null when unset. */
  tagline: string | null;
  /** Session count — the ticket card's right column. */
  sessions: number;
  /** True when the producer offers ongoing sessions without a fixed cap. */
  unlimitedSessions: boolean;
  /** Revision rounds from the wizard encoding (0 = not specified). */
  revisions: number;
  /** True when revision rounds are explicitly unlimited. */
  unlimitedRevisions: boolean;
  /** Every offered approved paid plan and its exact schedule. */
  paymentPlans: PaymentPlan[];
  /** Product-level headline master/composition terms. Null for legacy products. */
  royaltyTerms: ProductRoyaltyTerms | null;
  /** Producer-authored inline agreement. Null when absent. */
  agreementText: string | null;
  /** Pricing behavior used by the unified quantity picker. */
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  /** Server-authored per-song volume ladder. */
  volumeTiers: VolumeTier[];
};

export type PurchaseTargetProject = {
  id: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active";
  workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
  updatedAtIso: string;
};

export type PurchaseAcceptancePreview = {
  productId: string;
  productName: string;
  producerName: string;
  status: string;
  target:
    | { kind: "new"; projectId?: never; projectTitle?: never }
    | {
        kind: "existing";
        projectId: string;
        projectTitle: string;
        lifecycleStatus: "waiting_for_payment" | "active";
        workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
        updatedAtIso: string;
      };
  snapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  schedule: Array<{ label: string; amountCents: number }>;
};

export type Producer = {
  name: string;
  initials: string;
  /** Cover-gradient hue so the booking thumbnail matches the store. */
  hue: number;
};

export type AgreementTerm = {
  heading: string;
  body: string;
  points?: string[];
};

export function formatPurchaseMoney(
  priceCents: number,
  currency: string,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
}

// Compatibility helper used by older ILS-only artist surfaces.
export function formatShekels(priceCents: number): string {
  return formatPurchaseMoney(priceCents, "ILS");
}

// Cover-art gradients (match the store's oklch covers) so the booking
// thumbnail reads like the record-shelf store. `swatch` = the solid avatar
// gradient; `cover` adds a top-down vignette for the larger ticket art.
export function swatchGradient(hue: number): string {
  return `linear-gradient(135deg, oklch(0.72 0.13 ${String(hue)}) 0%, oklch(0.46 0.14 ${String((hue + 30) % 360)}) 100%)`;
}

export function coverGradient(hue: number): string {
  const vignette =
    "radial-gradient(125% 115% at 50% 6%, transparent 42%, rgb(17 16 9 / 0.30) 100%)";
  return `${vignette}, linear-gradient(168deg, oklch(0.82 0.075 ${String(hue)}) 0%, oklch(0.60 0.13 ${String((hue + 8) % 360)}) 52%, oklch(0.42 0.135 ${String((hue + 24) % 360)}) 100%)`;
}

// "What's included" fallback — a producer may not have filled deliverables;
// the terms list still needs a body line under "This booking covers:".
export function includesOrFallback(includes: string[], producerName: string): string[] {
  return includes.length > 0
    ? includes
    : [`Everything agreed with ${producerName} for this offer`];
}

// The plain-language agreement summary shown above the binding PDF. The PDF
// is the binding document; this is the readable version (design system §7).
export function buildAgreementTerms(producerName: string, includes: string[]): AgreementTerm[] {
  return [
    {
      heading: "Booking & approval",
      body: `You're sending a request, not a confirmed booking. ${producerName} reviews it and may accept or decline. If approved, you choose an enabled payment plan and accept one exact agreement. Only that final acceptance freezes the price and terms.`,
    },
    {
      heading: "What's included",
      body: "This booking covers:",
      points: includesOrFallback(includes, producerName),
    },
    {
      heading: "Payment is handled off-app",
      body: `After approval you'll pay by bank transfer or Bit, using the details ${producerName} shares. Skitza records every payment but never processes, holds, or refunds money on your behalf.`,
    },
    {
      heading: "Payment plan",
      body: `Each installment follows the exact schedule you accept. ${producerName} shares the external payment instructions. Downloads stay locked until the booking is fully paid.`,
    },
    {
      heading: "Rescheduling & cancellation",
      body: `You can reschedule or cancel yourself up to the window set for this offer (shown when you book). Closer than that, message ${producerName} directly. Any refund or credit follows this agreement — not an app rule.`,
    },
    {
      heading: "Delivery & ownership",
      body: `Stream your delivered songs any time. Downloads unlock at full payment. The exact headline royalty terms and any producer-authored agreement are listed above.`,
    },
    {
      heading: "Records & notifications",
      body: `Your agreement, this timestamp, and every payment proof are saved to this booking. We notify you by app and email at each step.`,
    },
  ];
}
