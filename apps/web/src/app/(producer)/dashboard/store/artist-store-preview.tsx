"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, X } from "lucide-react";
import { useRef, useState } from "react";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import type { Producer, PurchaseProduct } from "~/components/artist/purchase/purchase-data";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { QuietProductList } from "~/components/artist/store/quiet-product-list";
import { producerHue, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { durationLabel } from "~/lib/purchase/product-mapping";
import type { TaxMode } from "~/lib/tax-mode";

import { decodeDescription } from "./description-encoding";
import type { StoreProduct } from "./store-screen";

interface ArtistStorePreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: StoreProduct[];
  producerName: string;
  producerLogoUrl: string | null;
  taxMode: TaxMode;
  taxRatePct: number;
}

type ArtistCardProduct = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  volumeTiers: { minQty: number; pricePerUnitCents: number }[] | null;
  sessionCount: number | null;
  durationMin: number | null;
};

function artistPricingModel(value: string): ArtistCardProduct["pricingModel"] {
  if (value === "per_song" || value === "hourly" || value === "bundle") return value;
  return "flat";
}

function toArtistCardProduct(product: StoreProduct): ArtistCardProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    pricingModel: artistPricingModel(product.pricingModel),
    volumeTiers: product.volumeTiers,
    sessionCount: product.sessionCount,
    durationMin: product.durationMin,
  };
}

function toPurchaseProduct(product: StoreProduct): PurchaseProduct {
  const description = decodeDescription(product.description);
  const pricingModel = product.pricingModel === "per_song" ? "per_song" : "flat";
  const hasSessionDuration = product.durationMin > 0;
  const unlimitedSessions = hasSessionDuration && product.sessionCount === 0;

  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    durationLabel: durationLabel(product.sessionCount, product.durationMin),
    includes: [...product.deliverables],
    tagline: description.tagline || null,
    sessions: product.sessionCount,
    unlimitedSessions,
    revisions: description.revisions,
    unlimitedRevisions: description.unlimitedRevisions,
    paymentPlans: product.paymentPlans,
    royaltyTerms: product.royaltyTerms,
    agreementText: (product.agreementText ?? description.contractText) || null,
    pricingModel,
    volumeTiers: product.volumeTiers ?? [],
  };
}

export function ArtistStorePreview({
  open,
  onOpenChange,
  products,
  producerName,
  producerLogoUrl,
  taxMode,
  taxRatePct,
}: ArtistStorePreviewProps) {
  const [detailProduct, setDetailProduct] = useState<StoreProduct | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const liveProducts = products.filter((product) => product.active);
  const [focal, ...rest] = liveProducts.map(toArtistCardProduct);
  const displayName = producerName.trim() || "Your studio";
  const producer: Producer = {
    name: displayName,
    initials: producerInitials(displayName),
    hue: producerHue(displayName),
  };

  function openDetails(product: StoreProduct | undefined, trigger: HTMLButtonElement) {
    if (!product) return;
    detailTriggerRef.current = trigger;
    setDetailProduct(product);
  }

  function openSecondaryDetails(trigger: HTMLButtonElement) {
    const row = trigger.closest("li");
    const list = row?.parentElement;
    if (!row || !list) return;
    const index = Array.from(list.children).indexOf(row);
    openDetails(liveProducts[index + 1], trigger);
  }

  function handlePreviewOpenChange(nextOpen: boolean) {
    if (!nextOpen) setDetailProduct(null);
    onOpenChange(nextOpen);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handlePreviewOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(17_16_9/0.56)] backdrop-blur-[5px]" />
        <DialogPrimitive.Content
          aria-describedby="artist-store-preview-description"
          className="fixed inset-0 z-[65] overflow-y-auto bg-[rgb(var(--bg-background))] outline-none"
        >
          <div className="sticky top-0 z-10 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.94)] backdrop-blur-xl">
            <div className="mx-auto flex min-h-16 w-full max-w-[920px] items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-dark))]"
                >
                  <Eye size={17} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <DialogPrimitive.Title className="font-display truncate text-[15px] font-extrabold tracking-[-0.015em] text-[rgb(var(--fg-default))]">
                    Preview as artist
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description
                    id="artist-store-preview-description"
                    className="truncate text-[11.5px] text-[rgb(var(--fg-muted))]"
                  >
                    Preview only · live products in artist order
                  </DialogPrimitive.Description>
                </div>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="sk-press inline-flex h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] shadow-sm hover:border-[rgb(var(--border-strong))]"
                >
                  <X size={15} strokeWidth={2.2} />
                  Close preview
                </button>
              </DialogPrimitive.Close>
            </div>
          </div>

          <main className="mx-auto w-full max-w-[760px] px-4 py-6 pb-16 sm:px-6 sm:py-10">
            <header className="mb-5 flex items-baseline justify-between px-1 sm:px-0">
              <h2 className="font-display text-[20px] leading-none font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
                Store
                <span className="text-[rgb(var(--brand-primary))]">.</span>
              </h2>
              <span className="font-mono text-[9.5px] font-bold tracking-[0.16em] text-[rgb(var(--fg-faint))] uppercase">
                Preview only
              </span>
            </header>

            <div className="space-y-6">
              <ProducerHero producerName={displayName} producerLogoUrl={producerLogoUrl} />

              {focal ? (
                <div aria-label="Artist Store product preview">
                  <FocalProductCard
                    product={focal}
                    producerName={displayName}
                    taxMode={taxMode}
                    taxRatePct={taxRatePct}
                    onPreviewDetails={(trigger) => {
                      openDetails(liveProducts[0], trigger);
                    }}
                  />
                  <div className="mt-6">
                    <QuietProductList
                      producerName={displayName}
                      products={rest}
                      taxMode={taxMode}
                      taxRatePct={taxRatePct}
                      onPreviewDetails={openSecondaryDetails}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-8 text-center">
                  <p className="font-display text-[17px] font-bold text-[rgb(var(--fg-default))]">
                    Your Store has no live products.
                  </p>
                  <p className="mx-auto mt-1 max-w-[38ch] text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
                    Publish a product to see it in the artist preview.
                  </p>
                </div>
              )}
            </div>
          </main>

          <DialogPrimitive.Root
            open={detailProduct !== null}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setDetailProduct(null);
            }}
          >
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[rgb(17_16_9/0.48)]" />
              <DialogPrimitive.Content
                aria-describedby={undefined}
                className="fixed inset-0 z-[75] overflow-y-auto bg-[rgb(var(--bg-background))] outline-none"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  detailTriggerRef.current?.focus();
                }}
              >
                <DialogPrimitive.Title className="sr-only">
                  Artist product detail preview
                </DialogPrimitive.Title>
                {detailProduct ? (
                  <ProductDetailScreen
                    product={toPurchaseProduct(detailProduct)}
                    producer={producer}
                    productId={detailProduct.id}
                    taxMode={taxMode}
                    taxRatePct={taxRatePct}
                    previewMode={true}
                    onPreviewBack={() => {
                      setDetailProduct(null);
                    }}
                  />
                ) : null}
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
