import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { ProductCard } from "~/components/artist/store/product-card";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreProducerPicker } from "./store-producer-picker";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Store — locked design system (Phase 5).
//
// Mobile: hero + producer carousel + product list, single column.
// Desktop: hero + producer carousel + product grid (2 cols on lg+).
//
// Buy flow uses the existing `/artist/store/[productId]` detail page;
// Phase 5 only redesigns the catalog tile + headers — the detail page
// keeps its current shape (out-of-scope for the visual refresh
// because Sheet-driven plan-picker variants are deferred).
export default async function StorePage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const sp = await searchParams;
  const studioFilter = sp.studio;

  const [{ products }, { studios }] = await Promise.all([
    caller.artist.store.products(
      studioFilter ? { producerId: studioFilter } : {},
    ),
    caller.artist.studios(),
  ]);

  const heading = (
    <header className="reveal-up">
      <h1 className="font-display text-[30px] font-extrabold tracking-tight lg:text-[44px] lg:leading-none">
        Store<span className="text-[rgb(var(--brand-primary))]">.</span>
      </h1>
      <p className="mt-1.5 text-sm text-[rgb(var(--fg-muted))] lg:mt-2">
        One-off products, beat packs, add-ons.
      </p>
    </header>
  );

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        {heading}
        <StoreProducerPicker studios={studios} />
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-12 text-center">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Empty shelf
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[rgb(var(--fg-muted))]">
            {studioFilter
              ? "This studio hasn't published anything to the store yet."
              : "Nothing in your stores yet. When your producers publish products, they show up here."}
          </p>
          {studioFilter ? (
            <Link
              href="/artist/store"
              className="mt-4 inline-block text-sm font-semibold text-[rgb(var(--brand-primary))] hover:underline"
            >
              Browse all studios
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      {heading}
      <StoreProducerPicker studios={studios} />
      <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-4">
        {products.map((p) => (
          <li key={p.id}>
            <ProductCard
              product={{
                id: p.id,
                name: p.name,
                description: p.description,
                priceCents: p.priceCents,
                currency: p.currency,
                pricingModel: p.pricingModel,
                producerName: p.producerName,
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
