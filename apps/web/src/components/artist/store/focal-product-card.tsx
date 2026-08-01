"use client";

import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";
import type { VolumeTier } from "~/lib/pricing";
import { formatPriceLabel, planLabel } from "~/lib/store/format-price-label";
import { productHref } from "~/lib/store/product-href";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

export function FocalProductCard({
  product,
  producerName,
  studioId,
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
  studioId?: string;
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
  if (product.durationMin && product.sessionCount === 0) {
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
      aria-label={`${product.name} from ${producerName}`}
      className="reveal-up relative isolate overflow-hidden rounded-[var(--radius-xl)] border p-5 shadow-[var(--shadow-lg)] sm:p-6"
      style={{
        background:
          "linear-gradient(145deg, rgb(var(--bg-sidebar)) 0%, rgb(var(--bg-sidebar) / 0.97) 68%, rgb(var(--brand-copper) / 0.4) 145%)",
        borderColor: "rgb(var(--fg-onsidebar) / 0.13)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full border border-[rgb(var(--fg-onsidebar)/0.08)]"
        style={{
          boxShadow:
            "inset 0 0 0 24px rgb(var(--fg-onsidebar) / 0.018), inset 0 0 0 48px rgb(var(--fg-onsidebar) / 0.015), inset 0 0 0 72px rgb(var(--fg-onsidebar) / 0.012)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 84% 12%, rgb(var(--brand-primary) / 0.2), transparent 31%)",
        }}
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 sm:flex-1">
          <h3 className="font-display text-[22px] leading-tight font-bold tracking-[-0.025em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-onsidebar))] sm:text-[25px]">
            {product.name}
          </h3>
          {product.description ? (
            <p className="mt-2 line-clamp-2 max-w-[62ch] text-[13.5px] leading-relaxed text-[rgb(var(--fg-onsidebar)/0.66)]">
              {product.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0">
          <p className="font-mono text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--brand-primary))] tabular-nums">
            {priceLabel}
          </p>
          {taxFootnote ? (
            <p className="mt-0.5 font-mono text-[9px] font-medium tracking-[0.06em] text-[rgb(var(--fg-onsidebar)/0.48)] uppercase">
              {taxFootnote}
            </p>
          ) : null}
        </div>
      </div>
      {meta.length > 0 ? (
        <p className="relative mt-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-onsidebar)/0.5)] uppercase">
          {meta.join(" · ")}
        </p>
      ) : null}
      {onPreviewDetails ? (
        <button
          type="button"
          onClick={(event) => {
            onPreviewDetails(event.currentTarget);
          }}
          className="sk-press relative mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-on-brand))]"
        >
          View service
        </button>
      ) : (
        <Link
          href={withArtistStudio(productHref(product), studioId)}
          className="sk-press relative mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-on-brand))]"
        >
          View service
        </Link>
      )}
    </article>
  );
}
