"use client";

import Link from "next/link";

import { coverGradient } from "~/components/artist/purchase/purchase-data";
import { producerHue } from "~/lib/_phase4-stubs/producer-color";
import type { VolumeTier } from "~/lib/pricing";
import { formatPriceLabel, planLabel } from "~/lib/store/format-price-label";
import { productHref } from "~/lib/store/product-href";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

// Producer's flagship offer — full-width focal card at the top of
// each storefront. A slim producer-hued cover band tops the card
// (same coverGradient the S3 funnel hero uses, so tapping through
// feels continuous), then title block left, price block right,
// description underneath, full-width "View details" CTA, and a quiet
// external-payment truth below the CTA.
export function FocalProductCard({
  product,
  producerName,
  taxMode = "tax_free",
  taxRatePct = 18,
  onPreviewDetails,
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
  producerName: string;
  taxMode?: TaxMode;
  taxRatePct?: number;
  /** Producer Review only: opens the real artist detail preview without navigation. */
  onPreviewDetails?: (trigger: HTMLButtonElement) => void;
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
  if (product.sessionCount === 0) {
    meta.push("UNLIMITED SESSIONS");
  } else if (product.sessionCount && product.sessionCount > 0) {
    meta.push(
      `${String(product.sessionCount)}× ${product.sessionCount > 1 ? "SESSIONS" : "SESSION"}`,
    );
  }
  if (product.durationMin) {
    meta.push(`${String(product.durationMin)} MIN`);
  }

  return (
    <article
      className="reveal-up overflow-hidden rounded-[var(--radius-lg)] border"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* slim record-sleeve cover band — producer-hued coverGradient
          (matches the S3 funnel band this card links into) with a
          quiet mono SIGNATURE tag pinned to its bottom edge */}
      <div
        aria-hidden
        className="flex h-[76px] items-end px-6 pb-2.5 sm:h-[84px] sm:px-8"
        style={{ background: coverGradient(producerHue(producerName)) }}
      >
        <span className="font-mono text-[9px] font-bold tracking-[0.22em] text-white/85 uppercase">
          Signature
        </span>
      </div>
      <div className="p-6 sm:p-8">
        {/* SK-49: below sm the title/meta take the full width and the price
          drops to its own line — side-by-side squeezed the meta into a
          one-word-per-line column on phones. sm+ is the original layout. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <h3 className="font-display text-[22px] leading-tight font-extrabold tracking-tight [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))] sm:text-[24px]">
              {product.name}
            </h3>
            {meta.length > 0 ? (
              <p className="mt-1.5 font-mono text-[10.5px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                {meta.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-row items-baseline gap-2 sm:flex-col sm:items-end sm:gap-1">
            <span
              className="shrink-0 font-mono text-[22px] font-extrabold text-[rgb(var(--fg-default))] tabular-nums"
              style={{ letterSpacing: "-0.02em" }}
            >
              {priceLabel}
            </span>
            {taxFootnote ? (
              <span className="flex items-center gap-1 font-mono text-[10px] font-medium tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase tabular-nums">
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

        {onPreviewDetails ? (
          <button
            type="button"
            onClick={(event) => {
              onPreviewDetails(event.currentTarget);
            }}
            className="sk-press mt-5 flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] py-3 text-[14px] font-bold"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-onsidebar))",
            }}
          >
            View details
          </button>
        ) : (
          <Link
            href={productHref(product)}
            className="sk-press mt-5 flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] py-3 text-[14px] font-bold"
            style={{
              background: "rgb(var(--bg-sidebar))",
              color: "rgb(var(--fg-onsidebar))",
            }}
          >
            View details
          </Link>
        )}

        <p className="mt-3 text-center font-mono text-[10px] font-medium tracking-[0.18em] text-[rgb(var(--fg-faint))] uppercase">
          Request details · payments stay external
        </p>
      </div>
    </article>
  );
}
