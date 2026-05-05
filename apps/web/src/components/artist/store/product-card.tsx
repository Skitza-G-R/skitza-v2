import Link from "next/link";

import { ProducerAvatar } from "../producer-avatar";

// Product card — locked design system (Phase 5).
//
// One row per product. Layout: title + tagline (description fallback)
// on the left, big JetBrains Mono price on the right. Producer chip
// and pricing-model pill underneath. Tap-target = full row.
//
// `pricingModel` mirrors the existing artist.store.products tRPC
// shape; `per_song` and `hourly` show as "from $X" because the row's
// cents column doesn't carry quantity-dependent totals.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

const PRICING_LABEL: Record<
  "flat" | "per_song" | "hourly" | "bundle",
  string
> = {
  flat: "Pay once",
  per_song: "Per song",
  hourly: "Hourly",
  bundle: "Bundle",
};

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
  const sub = product.description
    ? truncate(product.description, 90)
    : `${product.producerName} · ${PRICING_LABEL[product.pricingModel]}`;

  return (
    <Link
      href={`/artist/store/${product.id}`}
      className="sk-lift block rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 lg:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight text-[rgb(var(--fg-default))] lg:text-[17px]">
            {product.name}
          </p>
          <p className="mt-1 text-xs leading-snug text-[rgb(var(--fg-muted))] lg:text-[13px]">
            {sub}
          </p>
        </div>
        <p className="shrink-0 font-mono text-lg font-extrabold leading-none tracking-tight text-[rgb(var(--fg-default))] lg:text-[20px]">
          {priceLabel}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProducerAvatar name={product.producerName} size={20} />
          <span className="truncate text-xs text-[rgb(var(--fg-muted))]">
            {product.producerName}
          </span>
        </div>
        <span className="pill pill-neutral shrink-0">
          {PRICING_LABEL[product.pricingModel]}
        </span>
      </div>
    </Link>
  );
}

function formatCents(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  return `${prefix}${major}`;
}

function formatPriceLabel(product: {
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
}): string {
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
