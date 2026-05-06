import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { ProductCard } from "~/components/artist/store/product-card";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreProducerPicker } from "./store-producer-picker";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Server Component. Lists products from all of the artist's studios
// (or one if ?studio=<id> is present — the same convention the Book
// tab uses). Polished with hero + producer banner card to match the
// locked design's "Store · producer card · product list" hierarchy.
//
// The artist layout gates sign-in; the auth() check here is
// defense-in-depth.
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

  const activeStudio = studioFilter
    ? studios.find((s) => s.producerId === studioFilter)
    : null;

  return (
    <div className="reveal-up space-y-4">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          Store
          <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
          One-off products, beat packs, add-ons.
        </p>
      </header>

      <StoreProducerPicker studios={studios} />

      {/* Producer banner — only when filtered to a single producer. The
          gradient block mirrors the locked design's "Producer · name"
          hero card, anchoring the catalog to the studio context. */}
      {activeStudio ? (
        <div
          className="reveal-up overflow-hidden rounded-[var(--radius-lg)] p-4 text-[rgb(var(--fg-onsidebar))]"
          style={{
            background:
              "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
          }}
        >
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-70">
            Producer
          </p>
          <p className="mt-0.5 font-display text-[22px] font-extrabold leading-none tracking-tight">
            {activeStudio.name}
          </p>
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="space-y-3 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
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
      ) : (
        <div className="space-y-2.5">
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
                sessionCount: p.sessionCount,
                durationMin: p.durationMin,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
