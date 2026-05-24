import { fromPrice, type VolumeTier } from "~/lib/pricing";

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

const PLAN_LABELS: Record<
  "flat" | "per_song" | "hourly" | "bundle",
  string
> = {
  flat: "pay once",
  per_song: "per song",
  hourly: "per hour",
  bundle: "bundle",
};

export function formatCents(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${prefix}${major}`;
}

export function planLabel(
  model: "flat" | "per_song" | "hourly" | "bundle",
): string {
  return PLAN_LABELS[model];
}

export function formatPriceLabel(product: {
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  volumeTiers: VolumeTier[] | null;
}): string {
  if (product.pricingModel === "per_song") {
    const tiers = product.volumeTiers ?? [];
    const minCents = tiers.length > 0 ? fromPrice(tiers) : product.priceCents;
    return minCents > 0
      ? `From ${formatCents(minCents, product.currency)}/song`
      : "Variable";
  }
  if (product.pricingModel === "hourly") {
    return product.priceCents > 0
      ? `from ${formatCents(product.priceCents, product.currency)}`
      : "Variable";
  }
  return formatCents(product.priceCents, product.currency);
}
