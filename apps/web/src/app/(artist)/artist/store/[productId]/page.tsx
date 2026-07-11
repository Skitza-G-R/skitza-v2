import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { coerceTaxMode, taxModeFootnote } from "~/lib/tax-mode";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { StoreProductClient } from "./store-product-client";

type PageProps = { params: Promise<{ productId: string }> };

// Server Component. Loads the product + plan options, hands off to a
// Client Component that owns the PlanPicker state + "Continue to
// checkout" action. Ownership guards live inside the tRPC procedure
// (NOT_FOUND on miss) — we just translate that into Next's notFound()
// so routing shows a 404 page rather than a server error.
export default async function StoreProductPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const { productId } = await params;

  let product: Awaited<
    ReturnType<typeof caller.artist.store.product>
  >;
  try {
    product = await caller.artist.store.product({ productId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Resolve VAT footnote once at the top so the hero render stays
  // declarative — no inline IIFE. coerceTaxMode folds legacy values
  // (pre-migration-0019) into the new shape so this never crashes.
  const taxMode = coerceTaxMode(product.producerTaxMode);
  const taxRatePct = product.producerTaxRatePct;
  const taxFootnote = taxModeFootnote(taxMode, taxRatePct);
  const royalty = royaltyTermsDisplay(product.royaltyTerms);
  const agreementUrl = safeAgreementUrl(product.contractUrl);

  return (
    <div className="space-y-5">
      <Link
        href="/artist/store"
        className="inline-block text-xs text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-secondary))]"
      >
        ← Back to store
      </Link>

      <div className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {product.producerName}
        </p>
        <h1
          className="mt-2 break-words font-display text-2xl leading-tight [overflow-wrap:anywhere]"
          style={{ fontWeight: 700 }}
        >
          {product.name}
        </h1>
        {product.description ? (
          <p className="mt-3 text-sm text-[rgb(var(--fg-secondary))]">
            {product.description}
          </p>
        ) : null}
        {/* Migration 0018 — VAT disclosure. Separated by a hairline
            divider + tiny uppercase eyebrow so the line reads as a
            legal/financial tag, not a continuation of the description.
            Matches the producer-name eyebrow at the top of the hero
            for visual symmetry. */}
        {taxFootnote ? (
          <div className="mt-4 flex items-center gap-2 border-t border-[rgb(var(--border-subtle))] pt-3">
            <span
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--fg-faint))]"
              aria-hidden
            >
              Tax
            </span>
            <span className="text-[11.5px] tabular-nums text-[rgb(var(--fg-muted))]">
              {taxFootnote}
            </span>
          </div>
        ) : null}
      </div>

      <section className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] p-5 ring-1 ring-[rgb(var(--border-subtle))]">
        <h2 className="font-display text-base font-bold text-[rgb(var(--fg-default))]">
          Rights & agreement
        </h2>
        <dl className="mt-3 grid gap-2.5 text-sm">
          <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
            <dt className="font-medium text-[rgb(var(--fg-muted))]">Master</dt>
            <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">{royalty.master}</dd>
          </div>
          <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
            <dt className="font-medium text-[rgb(var(--fg-muted))]">Composition</dt>
            <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
              {royalty.composition}
            </dd>
          </div>
        </dl>
        {product.royaltyTerms?.notes ? (
          <p className="mt-4 whitespace-pre-wrap break-words border-t border-[rgb(var(--border-subtle))] pt-4 text-sm leading-relaxed text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
            {product.royaltyTerms.notes}
          </p>
        ) : null}
        {product.agreementText ? (
          <p className="mt-4 whitespace-pre-wrap break-words border-t border-[rgb(var(--border-subtle))] pt-4 text-sm leading-relaxed text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
            {product.agreementText}
          </p>
        ) : null}
        {agreementUrl ? (
          <a
            href={agreementUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-sm font-semibold text-[rgb(var(--brand-primary))]"
          >
            Open agreement link
          </a>
        ) : null}
      </section>

      <StoreProductClient
        product={{
          id: product.id,
          name: product.name,
          priceCents: product.priceCents,
          currency: product.currency,
          paymentPlans: product.paymentPlans,
          pricingModel: product.pricingModel,
          volumeTiers: product.volumeTiers,
        }}
      />
    </div>
  );
}
