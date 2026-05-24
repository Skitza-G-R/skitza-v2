import Link from "next/link";

import type { VolumeTier } from "~/lib/pricing";
import { formatPriceLabel, planLabel } from "~/lib/store/format-price-label";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

// Producer's flagship offer — full-width focal card at the top of
// each storefront. Title block left, price block right, description
// underneath, full-width "View details" CTA, "Stripe · soon" as a
// quiet centered footnote below the CTA so it reads as a coming-soon
// disclosure, not a competing sibling action.
export function FocalProductCard({
  product,
  taxMode = "tax_free",
  taxRatePct = 18,
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    sessionCount: number | null;
    durationMin: number | null;
  };
  taxMode?: TaxMode;
  taxRatePct?: number;
}) {
  const priceLabel = formatPriceLabel(product);
  const taxFootnote = taxModeFootnote(taxMode, taxRatePct);

  const meta: string[] = [];
  if (product.pricingModel === "per_song") {
    meta.push("PER SONG");
    if ((product.volumeTiers?.length ?? 0) >= 2) {
      meta.push("DISCOUNTS FOR BIGGER PROJECTS");
    }
  } else {
    meta.push(planLabel(product.pricingModel).toUpperCase());
  }
  if (product.sessionCount && product.sessionCount > 0) {
    meta.push(
      `${String(product.sessionCount)}× ${product.sessionCount > 1 ? "SESSIONS" : "SESSION"}`,
    );
  }
  if (product.durationMin) {
    meta.push(`${String(product.durationMin)} MIN`);
  }

  return (
    <article
      className="reveal-up rounded-[var(--radius-lg)] border p-6 sm:p-8"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-[rgb(var(--fg-default))] sm:text-[24px]">
            {product.name}
          </h3>
          {meta.length > 0 ? (
            <p className="mt-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              {meta.join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="shrink-0 font-mono text-[22px] font-extrabold tabular-nums text-[rgb(var(--fg-default))]"
            style={{ letterSpacing: "-0.02em" }}
          >
            {priceLabel}
          </span>
          {taxFootnote ? (
            <span className="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] tabular-nums text-[rgb(var(--fg-muted))]">
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
        <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          {product.description}
        </p>
      ) : null}

      <Link
        href={`/artist/store/${product.id}`}
        className="sk-press mt-5 flex w-full items-center justify-center rounded-[var(--radius-lg)] py-3 text-[14px] font-bold"
        style={{
          background: "rgb(var(--bg-sidebar))",
          color: "rgb(var(--fg-onsidebar))",
        }}
      >
        View details
      </Link>

      <p className="mt-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-faint))]">
        Stripe · payments soon
      </p>
    </article>
  );
}
