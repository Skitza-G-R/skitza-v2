import { auth } from "@clerk/nextjs/server";

import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { QuietProductList } from "~/components/artist/store/quiet-product-list";
import { coerceTaxMode } from "~/lib/tax-mode";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Boutique storefront per producer. The chrome StudioSwitcher
// (mobile top bar + desktop sidebar) writes ?studio=<id>; we resolve
// the active producer, the producer's products (ordered by drag
// position), and render hero → focal → "Also from" list.
//
// Edge cases:
//   * zero studios  → "Waiting for an invite" card (mirrors /artist/book)
//   * zero products → hero + soft "still setting up" card
//   * one product   → hero + focal only (QuietProductList returns null)
//
// The artist layout already gates sign-in; the auth() call here is
// defense-in-depth, matching the other tabs.
export default async function StorePage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const sp = await searchParams;

  const { studios } = await caller.artist.studios();
  if (studios.length === 0) {
    return (
      <div className="reveal-up mx-auto w-full max-w-[600px] space-y-5 lg:max-w-[760px]">
        <StoreEyebrow />
        <EmptyStudios />
      </div>
    );
  }

  // Active producer: ?studio= wins, else first studio (artist.studios
  // returns them desc by lastSeenAt server-side). The length === 0
  // case is handled above, so studios[0] is defined here — the
  // explicit guard exists to satisfy the no-non-null-assertion lint.
  const activeStudio =
    studios.find((s) => s.producerId === sp.studio) ?? studios[0];
  if (!activeStudio) return null;

  const { products } = await caller.artist.store.products({
    producerId: activeStudio.producerId,
  });

  const [focal, ...rest] = products;

  // VAT context lives on the producer (migration 0019). All products
  // in this storefront inherit it from the active producer's row, so
  // we read it off the first product if present, else fall back to
  // the schema defaults.
  const taxMode = coerceTaxMode(focal?.producerTaxMode ?? "tax_free");
  const taxRatePct = focal?.producerTaxRatePct ?? 18;

  return (
    <div className="mx-auto w-full max-w-[600px] space-y-6 lg:max-w-[760px]">
      <StoreEyebrow />
      <ProducerHero
        producerName={activeStudio.name}
        producerLogoUrl={activeStudio.logoUrl}
      />
      {focal ? (
        <FocalProductCard
          product={{
            id: focal.id,
            name: focal.name,
            description: focal.description,
            priceCents: focal.priceCents,
            currency: focal.currency,
            pricingModel: focal.pricingModel,
            volumeTiers: focal.volumeTiers,
            sessionCount: focal.sessionCount,
            durationMin: focal.durationMin,
          }}
          taxMode={taxMode}
          taxRatePct={taxRatePct}
        />
      ) : (
        <EmptyStorefront producerName={activeStudio.name} />
      )}
      <QuietProductList
        producerName={activeStudio.name}
        products={rest.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          currency: p.currency,
          pricingModel: p.pricingModel,
          volumeTiers: p.volumeTiers,
          sessionCount: p.sessionCount,
          durationMin: p.durationMin,
        }))}
      />
    </div>
  );
}

// Tiny page-identity row. The producer hero carries the real visual
// weight; this stays a quiet route handle. Mirrors BookEyebrow.
function StoreEyebrow() {
  return (
    <header className="flex items-baseline justify-between px-1 sm:px-0">
      <h1 className="font-display text-[20px] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))]">
        Store
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
    </header>
  );
}

// Soft empty state for a producer who hasn't published yet.
function EmptyStorefront({ producerName }: { producerName: string }) {
  return (
    <div
      className="reveal-up rounded-[var(--radius-lg)] border border-dashed px-5 py-6 text-center"
      style={{
        background: "rgb(var(--bg-sunken))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <p className="text-[13px] text-[rgb(var(--fg-secondary))]">
        {producerName} is still setting up their store. Check back soon.
      </p>
    </div>
  );
}

// Reused shape from /artist/book's EmptyStudios. Kept local so the
// Store page doesn't depend on the Book page; if Raz later promotes
// this to a shared component, swap the import.
function EmptyStudios() {
  return (
    <section
      aria-label="No studios yet"
      className="overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        aria-hidden
        className="flex h-28 items-center justify-center"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgb(var(--brand-primary) / 0.18), transparent 65%), rgb(var(--bg-overlay))",
        }}
      >
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-[0.24em]"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          Waiting for an invite
        </span>
      </div>
      <div className="px-6 py-6 lg:px-8">
        <p className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          No storefronts yet.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Once a producer connects you, their store appears here.
        </p>
      </div>
    </section>
  );
}
