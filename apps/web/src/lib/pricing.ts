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

export interface TierValidation {
  errors: string[];
  warnings: string[];
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
    if (sorted[i].pricePerUnitCents >= sorted[i - 1].pricePerUnitCents) {
      warnings.push("PRICE_NOT_DECREASING");
      break;
    }
  }
  return { errors, warnings };
}
