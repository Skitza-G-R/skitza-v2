import Link from "next/link";

// Server Component — one row in the artist's store catalog. Polished
// to mirror the locked design's "title + meta · price · buy + pill"
// layout. Tap opens the product detail page which renders the plan
// picker. For per-song / hourly pricing models we surface "from
// <volumeTier0>" / "from <hourlyRate>" because the actual total
// depends on quantity the artist chooses. For flat / bundle products
// we show the price directly.
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
    sessionCount: number | null;
    durationMin: number | null;
  };
}) {
  const priceLabel = formatPriceLabel(product);
  const meta: string[] = [];
  if (product.sessionCount && product.sessionCount > 0) {
    meta.push(
      `${String(product.sessionCount)} session${product.sessionCount > 1 ? "s" : ""}`,
    );
  }
  if (product.durationMin) {
    meta.push(`${String(product.durationMin)} min`);
  }
  meta.push(planLabel(product.pricingModel));

  return (
    <article className="reveal-up rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold text-[rgb(var(--fg-default))]">
            {product.name}
          </p>
          <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
            {product.producerName}
            {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
          </p>
        </div>
        <span
          className="shrink-0 font-mono text-[17px] font-extrabold tracking-tight text-[rgb(var(--fg-default))]"
          style={{ letterSpacing: "-0.02em" }}
        >
          {priceLabel}
        </span>
      </div>

      {product.description ? (
        <p className="mt-2 line-clamp-2 text-[12.5px] text-[rgb(var(--fg-secondary))]">
          {product.description}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/artist/store/${product.id}`}
          className="sk-press flex flex-1 items-center justify-center rounded-[var(--radius-sm)] py-2 text-[13px] font-bold"
          style={{
            background: "rgb(var(--bg-sidebar))",
            color: "rgb(var(--fg-onsidebar))",
          }}
        >
          View details
        </Link>
        <span
          className="rounded-[var(--radius-lg)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          Stripe · soon
        </span>
      </div>
    </article>
  );
}

const PLAN_LABELS: Record<
  "flat" | "per_song" | "hourly" | "bundle",
  string
> = {
  flat: "pay once",
  per_song: "per song",
  hourly: "per hour",
  bundle: "bundle",
};

function planLabel(model: "flat" | "per_song" | "hourly" | "bundle"): string {
  return PLAN_LABELS[model];
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
