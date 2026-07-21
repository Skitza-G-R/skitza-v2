"use client";

import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";
import type { VolumeTier } from "~/lib/pricing";
import { formatPriceLabel } from "~/lib/store/format-price-label";
import { productHref } from "~/lib/store/product-href";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

// "Also from {Producer}" — the quiet tail under the focal card.
// Borderless rows with hairline dividers, whole row tappable. Meta
// trimmed to one short signal per row since the focal card already
// taught the artist what each product type looks like.
export function QuietProductList({
  producerName,
  studioId,
  products,
  taxMode = "tax_free",
  taxRatePct = 18,
  onPreviewDetails,
}: {
  producerName: string;
  studioId?: string;
  products: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    sessionCount: number | null;
    durationMin: number | null;
  }[];
  taxMode?: TaxMode;
  taxRatePct?: number;
  /** Producer Review only: opens the real artist detail preview without navigation. */
  onPreviewDetails?: (trigger: HTMLButtonElement) => void;
}) {
  if (products.length === 0) return null;

  return (
    <section className="reveal-up">
      <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
        Also from {producerName}
      </p>
      <ul
        className="overflow-hidden rounded-[var(--radius-lg)]"
        style={{
          background: "rgb(var(--bg-elevated))",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {products.map((product, i) => {
          const isLast = i === products.length - 1;
          const meta = shortMeta(product);
          const taxFootnote = taxModeFootnote(taxMode, taxRatePct);
          const rowClassName = `sk-press flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left ${
            isLast ? "" : "border-b"
          }`;
          const rowContents = (
            <>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[14px] font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                  {product.name}
                </p>
                {meta ? (
                  <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                    {meta}
                  </p>
                ) : null}
              </div>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span
                  className="font-mono text-[14px] font-bold text-[rgb(var(--fg-default))] tabular-nums"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {formatPriceLabel(product)}
                </span>
                {taxFootnote ? (
                  <span className="font-mono text-[9px] font-medium tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase tabular-nums">
                    {taxFootnote}
                  </span>
                ) : null}
              </span>
            </>
          );
          return (
            <li key={product.id}>
              {onPreviewDetails ? (
                <button
                  type="button"
                  className={rowClassName}
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                  onClick={(event) => {
                    onPreviewDetails(event.currentTarget);
                  }}
                >
                  {rowContents}
                </button>
              ) : (
                <Link
                  href={withArtistStudio(productHref(product), studioId)}
                  className={rowClassName}
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  {rowContents}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shortMeta(product: {
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  sessionCount: number | null;
  durationMin: number | null;
}): string | null {
  if (product.pricingModel === "per_song") return "PER SONG";
  if (product.pricingModel === "hourly") {
    return product.durationMin ? `${String(product.durationMin)} MIN` : "PER HOUR";
  }
  if (product.sessionCount && product.sessionCount > 0) {
    return `${String(product.sessionCount)}× SESSION${product.sessionCount > 1 ? "S" : ""}`;
  }
  if (product.durationMin) return `${String(product.durationMin)} MIN`;
  return null;
}
