import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { ProductCard } from "~/components/artist/store/product-card";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreProducerPicker } from "./store-producer-picker";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Server Component. Lists products from all of the artist's studios
// (or one if ?studio=<id> is present — the same convention the Book
// tab uses). The artist layout gates sign-in; the auth() check here
// is defense-in-depth.
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

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Store</h1>
        <StoreProducerPicker studios={studios} />
        <div className="space-y-3 py-12 text-center">
          <p className="text-sm text-[rgb(var(--fg-secondary))]">
            {studioFilter
              ? "This studio hasn't published anything to the store yet."
              : "Nothing in your stores yet. When your producers publish products, they show up here."}
          </p>
          {studioFilter ? (
            <Link
              href="/artist/store"
              className="inline-block text-xs text-[rgb(var(--brand-primary))] hover:underline"
            >
              Browse all studios
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Store</h1>
      <StoreProducerPicker studios={studios} />
      <div className="space-y-2">
        {products.map((p) => (
          <ProductCard
            key={p.id}
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
        ))}
      </div>
    </div>
  );
}
