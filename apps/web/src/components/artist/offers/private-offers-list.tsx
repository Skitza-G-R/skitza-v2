import type { PurchaseCommercialSnapshot } from "@skitza/db";
import Link from "next/link";

import { formatPurchaseMoney } from "~/components/artist/purchase/purchase-data";

export type PrivateOfferListItem = Readonly<{
  id: string;
  producerName: string | null;
  commercialDraft: PurchaseCommercialSnapshot;
  expiresAt: Date;
}>;

function formatExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(expiresAt);
}

/**
 * Renders private offers that the authenticated server query has already
 * limited to the current artist and removed when expired.
 */
export function PrivateOffersList({ offers }: { offers: readonly PrivateOfferListItem[] }) {
  if (offers.length === 0) return null;

  return (
    <section className="min-w-0" aria-labelledby="private-offers-heading">
      <header className="mb-2 flex min-w-0 items-baseline justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-2">
        <h2
          id="private-offers-heading"
          className="min-w-0 text-[14px] font-bold text-[rgb(var(--fg-default))]"
          style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
        >
          Offers for you
        </h2>
        <span className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
          {offers.length} {offers.length === 1 ? "offer" : "offers"}
        </span>
      </header>

      <ul className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]">
        {offers.map((offer, index) => {
          const snapshot = offer.commercialDraft;
          return (
            <li
              key={offer.id}
              className={
                index === offers.length - 1
                  ? "min-w-0"
                  : "min-w-0 border-b border-[rgb(var(--border-subtle))]"
              }
            >
              <Link
                href={`/artist/offers/${encodeURIComponent(offer.id)}`}
                className="group flex min-w-0 flex-col gap-3 px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-sunken))] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[rgb(var(--focus-ring))] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                    {snapshot.productOrOfferName}
                  </span>
                  <span className="mt-1 block min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-muted))]">
                    {offer.producerName?.trim() || "Your producer"}
                    {snapshot.service ? ` · ${snapshot.service}` : ""}
                  </span>
                  <time
                    dateTime={offer.expiresAt.toISOString()}
                    className="mt-1.5 block font-mono text-[10px] tracking-[0.05em] text-[rgb(var(--fg-muted))] uppercase"
                  >
                    Expires {formatExpiry(offer.expiresAt)}
                  </time>
                </span>

                <span className="flex min-w-0 items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                  <span className="min-w-0 text-right">
                    <span className="font-amount block text-[16px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                      {formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}
                    </span>
                    <span className="block font-mono text-[9px] tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
                      {snapshot.currency}
                    </span>
                  </span>
                  <span className="inline-flex min-h-9 shrink-0 items-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-3 text-[11.5px] font-bold text-[rgb(var(--brand-primary))] transition-[filter,transform] group-hover:brightness-110 group-active:scale-[0.98]">
                    Review
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
