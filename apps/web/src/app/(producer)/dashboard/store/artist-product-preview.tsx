"use client";

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef, useState } from "react";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import type { Producer, PurchaseProduct } from "~/components/artist/purchase/purchase-data";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { QuietProductList } from "~/components/artist/store/quiet-product-list";
import { producerHue, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { durationLabel } from "~/lib/purchase/product-mapping";
import type { VolumeTier } from "~/lib/pricing";
import type { TaxMode } from "~/lib/tax-mode";

interface ArtistProductPreviewProps {
  name: string;
  tagline: string;
  producerName?: string;
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
  sessions: number;
  unlimitedSessions: boolean;
  duration: string;
  includes: string[];
  revisions: number;
  unlimitedRevisions: boolean;
  paymentPlans: PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string;
  taxMode?: TaxMode;
  taxRatePct?: number;
  placement?: "focal" | "secondary";
}

function parseDurationMinutes(value: string): number {
  const match = /^(\d+)\s*min$/i.exec(value.trim());
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

/**
 * Producer Review deliberately renders the live artist components. Keeping
 * one card/detail implementation prevents a polished mock preview from
 * drifting away from what artists actually receive after sign-in.
 */
export function ArtistProductPreview({
  name,
  tagline,
  producerName = "Your studio",
  priceCents,
  currency,
  pricingModel,
  volumeTiers,
  sessions,
  unlimitedSessions,
  duration,
  includes,
  revisions,
  unlimitedRevisions,
  paymentPlans,
  royaltyTerms,
  agreementText,
  taxMode = "tax_free",
  taxRatePct = 18,
  placement = "focal",
}: ArtistProductPreviewProps) {
  const [showDetails, setShowDetails] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const durationMin = parseDurationMinutes(duration);
  const sessionCount = unlimitedSessions ? 0 : sessions;
  const displayName = producerName.trim() || "Your studio";
  const previewId = "artist-product-preview";

  const product: PurchaseProduct = {
    id: previewId,
    name,
    priceCents,
    currency,
    durationLabel: durationLabel(sessionCount, durationMin),
    includes,
    tagline: tagline || null,
    sessions: sessionCount,
    unlimitedSessions,
    revisions: unlimitedRevisions ? 0 : revisions,
    unlimitedRevisions,
    paymentPlans,
    royaltyTerms,
    agreementText: agreementText.trim() || null,
    pricingModel,
    volumeTiers,
  };
  const producer: Producer = {
    name: displayName,
    initials: producerInitials(displayName),
    hue: producerHue(displayName),
  };
  const cardProduct = {
    id: previewId,
    name,
    description: tagline || null,
    priceCents,
    currency,
    pricingModel,
    volumeTiers,
    sessionCount,
    durationMin,
  };

  function openDetails(trigger: HTMLButtonElement) {
    previewTriggerRef.current = trigger;
    setShowDetails(true);
  }

  return (
    <section className="sm:col-span-2" aria-labelledby="artist-product-preview-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3
            id="artist-product-preview-heading"
            className="font-display text-[15px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]"
          >
            Exact artist preview
          </h3>
          <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Signed-in Store {placement === "focal" ? "focal card" : "secondary row"} for{" "}
            {displayName}. Artists can open the real detail view below.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[9.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-faint))] uppercase">
          Preview only
        </span>
      </div>

      <div className="mx-auto max-w-[440px]">
        {placement === "focal" ? (
          <FocalProductCard
            product={cardProduct}
            producerName={displayName}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            onPreviewDetails={openDetails}
          />
        ) : (
          <QuietProductList
            producerName={displayName}
            products={[cardProduct]}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            onPreviewDetails={openDetails}
          />
        )}
      </div>

      <DialogPrimitive.Root open={showDetails} onOpenChange={setShowDetails}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[65] bg-[rgb(17_16_9/0.42)]" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[70] outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              previewTriggerRef.current?.focus();
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              Artist product detail preview
            </DialogPrimitive.Title>
            <ProductDetailScreen
              product={product}
              producer={producer}
              productId={previewId}
              taxMode={taxMode}
              taxRatePct={taxRatePct}
              previewMode={true}
              onPreviewBack={() => {
                setShowDetails(false);
              }}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
