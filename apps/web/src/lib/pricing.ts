export interface VolumeTier {
  minQty: number;
  pricePerUnitCents: number;
}

export function unitPriceFor(qty: number, tiers: VolumeTier[]): number {
  if (tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const first = sorted[0];
  if (!first) return 0;
  let active: VolumeTier = first;
  for (const tier of sorted) {
    if (qty >= tier.minQty) active = tier;
  }
  return active.pricePerUnitCents;
}

export function totalFor(qty: number, tiers: VolumeTier[]): number {
  return qty * unitPriceFor(qty, tiers);
}

export function fromPrice(tiers: VolumeTier[]): number {
  if (tiers.length === 0) return 0;
  return Math.min(...tiers.map((t) => t.pricePerUnitCents));
}

export interface TierValidation {
  errors: string[];
  warnings: string[];
}

// Project session credit math. For flat / bundle / hourly products
// `product.sessionCount` IS the total credit pool. For per_song
// products it means "sessions reserved per song the artist booked,"
// so the project's pool is `sessionCount * songQty`.
//
// 0 is the canonical "unlimited" marker — see booking.ts:101 (the
// store read side: `unlimitedSessions: p.sessionCount === 0`). When
// either side is 0 the result is 0 (still unlimited).
//
// Pure, no DB. Called from every project-insertion site (booking.ts
// confirm + confirmAfterPayment, checkout-initiator.ts).
export function computeProjectSessionCount(
  product: { pricingModel: string; sessionCount: number },
  songQty: number | null | undefined,
): number {
  if (product.sessionCount === 0) return 0;
  if (product.pricingModel !== "per_song") return product.sessionCount;
  const qty = songQty ?? 1;
  if (qty <= 0) return product.sessionCount;
  return product.sessionCount * qty;
}

export function validateTiers(tiers: VolumeTier[]): TierValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (const t of sorted) {
    if (t.minQty < 1) errors.push("MIN_QTY_TOO_LOW");
    if (seen.has(t.minQty)) errors.push("DUPLICATE_MIN_QTY");
    seen.add(t.minQty);
  }
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (!cur || !prev) continue;
    if (cur.pricePerUnitCents >= prev.pricePerUnitCents) {
      warnings.push("PRICE_NOT_DECREASING");
      break;
    }
  }
  return { errors, warnings };
}
