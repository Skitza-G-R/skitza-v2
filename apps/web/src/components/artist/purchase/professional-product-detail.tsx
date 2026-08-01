"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { withArtistStudio } from "~/lib/artist-studio-context";
import type { PurchaseProduct } from "./purchase-data";
import { formatPurchaseMoney } from "./purchase-data";
import { computeSongCountState, SongCountStepper } from "./song-count-stepper";

export function ProfessionalProductDetail({
  product,
  studioId,
  activePurchase,
  requestHrefOverride,
}: {
  product: PurchaseProduct;
  studioId: string;
  activePurchase: { href: string; label: string } | null;
  requestHrefOverride?: string | undefined;
}) {
  const isPerSong = product.pricingModel === "per_song";
  const tiers = useMemo(
    () =>
      isPerSong && product.volumeTiers.length === 0
        ? [{ minQty: 1, pricePerUnitCents: product.priceCents }]
        : product.volumeTiers,
    [isPerSong, product.priceCents, product.volumeTiers],
  );
  const [songCount, setSongCount] = useState(() =>
    isPerSong
      ? computeSongCountState(1, tiers)
      : {
          qty: 1,
          unitPriceCents: product.priceCents,
          totalCents: product.priceCents,
          savedCents: 0,
        },
  );
  const requestQuery = new URLSearchParams();
  if (isPerSong) requestQuery.set("songs", String(songCount.qty));
  const requestHref =
    requestHrefOverride ??
    withArtistStudio(
      `/artist/purchase/${encodeURIComponent(product.id)}/request${
        requestQuery.size > 0 ? `?${requestQuery.toString()}` : ""
      }`,
      studioId,
    );

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-5 sm:px-6 sm:py-8">
      <Link
        href={withArtistStudio("/artist/store", studioId)}
        className="inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        ← Store
      </Link>

      <header className="mt-3 border-b border-[rgb(var(--border-subtle))] pb-5">
        <h1 className="font-display max-w-[22ch] text-[clamp(2rem,7vw,3.35rem)] leading-[1.04] font-bold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          {product.name}
        </h1>
        <p className="mt-4 font-mono text-[clamp(1.45rem,5vw,2rem)] font-bold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          {isPerSong ? "From " : ""}
          {formatPurchaseMoney(songCount.totalCents, product.currency)}
        </p>
        {product.tagline ? (
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            {product.tagline}
          </p>
        ) : null}
      </header>

      {isPerSong ? (
        <section className="mt-5" aria-labelledby="song-quantity-heading">
          <h2
            id="song-quantity-heading"
            className="text-[13px] font-semibold text-[rgb(var(--fg-default))]"
          >
            Number of songs
          </h2>
          <div className="mt-2">
            <SongCountStepper
              tiers={tiers}
              currency={product.currency}
              taxMode="tax_free"
              taxRatePct={0}
              onChange={setSongCount}
            />
          </div>
        </section>
      ) : null}

      {product.includes.length > 0 ? (
        <section className="mt-6" aria-labelledby="included-heading">
          <h2
            id="included-heading"
            className="font-display text-[19px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
          >
            What is included
          </h2>
          <ul className="mt-3 list-none divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4">
            {product.includes.map((item) => (
              <li
                key={item}
                className="flex min-h-12 items-start gap-3 py-3 text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]"
              >
                <span aria-hidden className="mt-0.5 text-[rgb(var(--brand-primary-text))]">
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Service details">
        <DetailItem label="Timing" value={product.durationLabel} />
        <DetailItem
          label="Revisions"
          value={
            product.unlimitedRevisions
              ? "Unlimited"
              : product.revisions > 0
                ? `${String(product.revisions)} ${
                    product.revisions === 1 ? "revision" : "revisions"
                  }`
                : "Not included"
          }
        />
        {product.sessions > 0 || product.unlimitedSessions ? (
          <DetailItem
            label="Sessions"
            value={
              product.unlimitedSessions
                ? "Unlimited"
                : `${String(product.sessions)} ${
                    product.sessions === 1 ? "session" : "sessions"
                  }`
            }
          />
        ) : null}
      </section>

      <section className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
        <h2 className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
          Payment happens directly with the studio
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          After your request is approved, the studio will send Bank or Bit instructions. Skitza
          does not process the payment.
        </p>
      </section>

      {activePurchase ? (
        <section
          role="status"
          className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
        >
          <p className="text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            Finish your current purchase with this studio before starting another.
          </p>
          <Link
            href={withArtistStudio(activePurchase.href, studioId)}
            className="mt-2 inline-flex min-h-11 items-center text-[13px] font-bold text-[rgb(var(--brand-primary-text))]"
          >
            {activePurchase.label} →
          </Link>
        </section>
      ) : (
        <Link
          href={requestHref}
          className="sk-press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[14px] font-bold text-[rgb(var(--fg-onsidebar))] sm:w-auto"
        >
          Request to book
        </Link>
      )}
    </main>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="text-[10px] font-semibold text-[rgb(var(--fg-muted))]">{label}</p>
      <p className="mt-1 text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">{value}</p>
    </div>
  );
}
