export interface VolumeTier {
  minQty: number;
  pricePerUnitCents: number;
}

export function unitPriceFor(qty: number, tiers: VolumeTier[]): number {
  if (tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let active = sorted[0];
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
