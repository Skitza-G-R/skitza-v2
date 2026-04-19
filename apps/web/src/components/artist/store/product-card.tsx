import Link from "next/link";

// Server Component — one row in the artist's store catalog. Tap opens
// the product detail page which renders the plan picker. For
// per-song / hourly pricing models we surface "from <volumeTier0>" /
// "from <hourlyRate>" because the actual total depends on quantity
// the artist chooses. For flat / bundle products we show the price
// directly.
export function ProductCard({
  product,
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    producerName: string;
  };
}) {
  const priceLabel = formatPriceLabel(product);
  return (
    <Link
      href={`/artist/store/${product.id}`}
      className="sk-lift flex items-center gap-3 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 hover:border-[rgb(var(--brand-primary))]/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{product.name}</p>
        <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
          {product.producerName}
        </p>
      </div>
      <span className="shrink-0 font-mono text-xs text-[rgb(var(--brand-primary))]">
        {priceLabel}
      </span>
    </Link>
  );
}

// Currency glyph map mirrors the one in artist.ts formatter — keep
// them in sync if a new currency is added.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

function formatCents(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${prefix}${major}`;
}

function formatPriceLabel(product: {
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
}): string {
  // For per_song / hourly the priceCents stored on the row isn't the
  // truth — the row carries tiers/rate in separate columns we don't
  // fetch for the card. Fall back to "Variable" so the card stays
  // honest; the detail page shows the actual pricing shape.
  if (
    product.pricingModel === "per_song" ||
    product.pricingModel === "hourly"
  ) {
    return product.priceCents > 0
      ? `from ${formatCents(product.priceCents, product.currency)}`
      : "Variable";
  }
  return formatCents(product.priceCents, product.currency);
}
