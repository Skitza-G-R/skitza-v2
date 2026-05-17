import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { isTaxMode, taxModeFootnote } from "~/lib/tax-mode";
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
  // declarative — no inline IIFE.
  const taxFootnote = taxModeFootnote(
    isTaxMode(product.producerTaxMode) ? product.producerTaxMode : "none",
  );

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
          className="mt-2 font-display text-2xl leading-tight"
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
