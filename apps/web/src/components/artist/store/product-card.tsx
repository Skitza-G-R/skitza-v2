import Link from "next/link";

import { fromPrice, type VolumeTier } from "~/lib/pricing";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

// Server Component — one row in the artist's store catalog. Polished
// to mirror the locked design's "title + meta · price · buy + pill"
// layout. Tap opens the product detail page which renders the plan
// picker (flat) or the song-count stepper (per-song; Task 15).
//
// Per-song products surface the cheapest tier ("From $X/song") plus
// a "Discounts for bigger projects" tail when ≥2 tiers exist. Flat
// products keep the existing $X price label unchanged.
export function ProductCard({
  product,
  taxMode = "none",
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    producerName: string;
    sessionCount: number | null;
    durationMin: number | null;
  };
  // Producer's business-level VAT disclosure mode (migration 0018).
  // Default 'none' is safe for any caller that hasn't been updated
  // yet — the footnote renders to null and nothing changes.
  taxMode?: TaxMode;
}) {
  const priceLabel = formatPriceLabel(product);
  const showDiscountTail =
    product.pricingModel === "per_song" &&
    (product.volumeTiers?.length ?? 0) >= 2;
  const taxFootnote = taxModeFootnote(taxMode);
  const meta: string[] = [];
  if (product.sessionCount && product.sessionCount > 0) {
    meta.push(
      `${String(product.sessionCount)} session${product.sessionCount > 1 ? "s" : ""}`,
    );
  }
  if (product.durationMin) {
    meta.push(`${String(product.durationMin)} min`);
  }
  // Drop the "per song" meta tail when the price label already says
  // "/song" — avoids the duplicate signal that the redesign critique
  // flagged on the producer side.
  if (product.pricingModel !== "per_song") {
    meta.push(planLabel(product.pricingModel));
  }

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
        <div className="flex flex-col items-end gap-0.5">
          <span
            className="shrink-0 font-mono text-[17px] font-extrabold tracking-tight text-[rgb(var(--fg-default))]"
            style={{ letterSpacing: "-0.02em" }}
          >
            {priceLabel}
          </span>
          {showDiscountTail ? (
            <span className="text-[10.5px] font-medium text-[rgb(var(--fg-muted))]">
              Discounts for bigger projects
            </span>
          ) : null}
          {/* VAT disclosure — visually distinct from the discount line.
              Tiny leading dot anchor + tabular-nums on the % so it
              reads as a legal/financial tag, not a marketing claim.
              key={taxFootnote} re-mounts when the producer toggles
              mode so the .reveal-up entrance fires once on change. */}
          {taxFootnote ? (
            <span
              key={taxFootnote}
              className="reveal-up flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] tabular-nums text-[rgb(var(--fg-muted))]"
            >
              <span
                aria-hidden
                className="inline-block h-1 w-1 rounded-full bg-[rgb(var(--fg-faint))]"
              />
              {taxFootnote}
            </span>
          ) : null}
        </div>
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
          className="rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
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
  volumeTiers: VolumeTier[] | null;
}): string {
  if (product.pricingModel === "per_song") {
    // Cheapest tier wins "From" copy — that's the headline deal an
    // artist sees on the card. fromPrice() is the shared math
    // helper; the producer wizard's "Artists will see" preview
    // renders the same value so what the producer types is what the
    // artist reads.
    const tiers = product.volumeTiers ?? [];
    const minCents = tiers.length > 0 ? fromPrice(tiers) : product.priceCents;
    return minCents > 0 ? `From ${formatCents(minCents, product.currency)}/song` : "Variable";
  }
  if (product.pricingModel === "hourly") {
    return product.priceCents > 0
      ? `from ${formatCents(product.priceCents, product.currency)}`
      : "Variable";
  }
  return formatCents(product.priceCents, product.currency);
}
