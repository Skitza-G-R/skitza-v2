// page.tsx
//
// Producer Store catalog. Server component that fetches the product
// list + producer profile and hands them to <StoreScreen>. Mirrors the
// shape used by the legacy /dashboard/profile?tab=store page so the
// data layer stays untouched.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { coerceTaxMode } from "~/lib/tax-mode";
import { PrivateOfferManager } from "~/components/dashboard/offers/private-offer-manager";
import { ProducerRuntimeSafeView } from "~/components/dashboard/runtime/producer-runtime-safe-view";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreScreen, type StoreProduct } from "./store-screen";
import { buildPrivateOfferTemplateProduct } from "./private-offer-template";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export default async function StorePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [packages, profile, offerRecipients, offerHistory] = await Promise.all([
    caller.booking.packages.list(),
    caller.producer.me(),
    caller.privateOffers.recipients(),
    caller.privateOffers.producerList(),
  ]);

  const VALID = ["USD", "EUR", "GBP", "ILS"] as const;
  const defaultCurrency: Currency = (VALID as readonly string[]).includes(profile.defaultCurrency)
    ? (profile.defaultCurrency as Currency)
    : "USD";

  const taxMode = coerceTaxMode(profile.taxMode);
  const taxRatePct =
    typeof profile.taxRatePct === "number" && Number.isFinite(profile.taxRatePct)
      ? Math.max(0, Math.min(100, Math.round(profile.taxRatePct)))
      : 18;

  const products: StoreProduct[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    active: p.active,
    kind: p.kind,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    bookingEnabled: p.bookingEnabled,
    paymentPlans: p.paymentPlans,
    locationType: p.locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    agreementPdf: p.agreementPdf,
    legacyAgreementLinkPresent: p.legacyAgreementLinkPresent,
    royaltyTerms: p.royaltyTerms,
    agreementText: p.agreementText,
    deliverables: p.deliverables ?? [],
    pricingModel: p.pricingModel,
    volumeTiers: p.volumeTiers,
    removalAction: p.removalAction,
    privateOfferTemplate: buildPrivateOfferTemplateProduct(p, {
      taxMode,
      taxRatePct,
    }),
  }));

  return (
    <>
      <ProducerRuntimeSafeView
        slot="producer.store.safe-view"
        data={{
          productCount: products.length,
          liveProductCount: products.filter((product) => product.active).length,
        }}
      />
      <StoreScreen
        products={products}
        defaultCurrency={defaultCurrency}
        taxMode={taxMode}
        taxRatePct={taxRatePct}
        producerName={profile.displayName ?? "Your studio"}
        producerSlug={profile.slug}
        producerLogoUrl={profile.brand.logoUrl ?? null}
        privateOfferCount={offerHistory.offers.length}
        privateOfferRecipients={offerRecipients}
        privateOffers={
          <PrivateOfferManager
            recipients={offerRecipients}
            offers={offerHistory.offers}
            defaultCurrency={defaultCurrency}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
          />
        }
      />
    </>
  );
}
