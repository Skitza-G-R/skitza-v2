// Maps the real `artist.store.product` row (BE-1 era) onto the purchase
// funnel's screen props (`PurchaseProduct` / `Producer`). Pure functions —
// the S3/S4/S5 route pages call these so the screens stay data-only.

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import type { Producer, PurchaseProduct } from "~/components/artist/purchase/purchase-data";
import {
  producerHue,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

/** "90 min" / "2h" / "1h 30m" — compact session length. */
function formatMinutes(min: number): string {
  if (min < 60) return `${String(min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

/** Human duration line for the price row, derived from real product fields. */
export function durationLabel(sessionCount: number, durationMin: number): string {
  if (durationMin <= 0) return "No bookable sessions included";
  if (sessionCount === 0) return `Unlimited sessions · ${formatMinutes(durationMin)} each`;
  if (sessionCount <= 1) return `Single session · ${formatMinutes(durationMin)}`;
  return `${String(sessionCount)} sessions · ${formatMinutes(durationMin)} each`;
}

type StoreProductRow = {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  sessionCount: number;
  durationMin: number;
  deliverables: string[] | null;
  producerName: string | null;
  agreementText: string | null;
  royaltyTerms: ProductRoyaltyTerms | null;
  description: string | null;
  revisions: number;
  unlimitedRevisions: boolean;
  paymentPlans: PaymentPlan[];
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  volumeTiers: { minQty: number; pricePerUnitCents: number }[] | null;
};

/** Screen-shaped product from the real store row. */
export function toPurchaseProduct(row: StoreProductRow): PurchaseProduct {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    currency: row.currency,
    durationLabel: durationLabel(row.sessionCount, row.durationMin),
    includes: row.deliverables ?? [],
    tagline: row.description,
    sessions: row.sessionCount,
    unlimitedSessions: row.durationMin > 0 && row.sessionCount === 0,
    revisions: row.revisions,
    unlimitedRevisions: row.unlimitedRevisions,
    paymentPlans: [...row.paymentPlans],
    royaltyTerms: row.royaltyTerms ?? null,
    agreementText: row.agreementText ?? null,
    pricingModel: row.pricingModel,
    volumeTiers: row.volumeTiers ?? [],
  };
}

/** Screen-shaped producer (avatar hue + initials match the store's). */
export function toProducer(row: StoreProductRow): Producer {
  const name = row.producerName ?? "Your producer";
  return {
    name,
    initials: producerInitials(name),
    hue: producerHue(name),
  };
}
