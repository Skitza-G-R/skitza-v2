import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { PaymentPlan } from "@skitza/db";

import type { Currency } from "~/app/(producer)/dashboard/booking/package-form";
import {
  StorefrontScreen,
  type StorefrontProduct,
} from "~/components/dashboard/storefront/storefront-screen";
import type { PortfolioTrackRow } from "~/components/dashboard/setup/portfolio-section";
import { buildJoinUrl } from "~/lib/share/public-url";
import { appRouter } from "~/server/trpc/routers/_app";

import { ProfileTabs } from "./profile-tabs";
import { type ProfileTabKey, isProfileTab } from "./profile-tab-key";
import {
  PortfolioPanel,
  type ExternalLinkRow,
  type LibraryPickRow,
} from "../portfolio/portfolio-panel";

// Plan-label derivation kept local to the page so the StorefrontScreen
// stays presentational. Mirrors the design intent: the chip on each
// product card is a quick scan of how clients can pay, not a full
// matrix.
function derivePlanLabel(plans: PaymentPlan[]): string {
  if (plans.length === 0) return "Pay once";
  if (plans.length > 1) return `${String(plans.length)} plans`;
  const only = plans[0];
  if (!only) return "Pay once";
  if (only.kind === "full") return "Pay once";
  if (only.kind === "split_50_50") return "50/50";
  return `Monthly · ${String(only.installments)}×`;
}

const META: Record<ProfileTabKey, { title: string; description: string }> = {
  store: {
    title: "Store",
    description: "The services artists can book and pay for from your link.",
  },
  portfolio: {
    title: "Portfolio",
    description:
      "Tracks and links visitors see on your public page. Pick which tracks are public samples.",
  },
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await searchParams;
  const active: ProfileTabKey = isProfileTab(resolved.tab) ? resolved.tab : "store";

  const caller = appRouter.createCaller({ userId });

  // Store tab fetches the product list + producer profile. Profile
  // gives us the public storefront URL we surface above the
  // products tab toggle, plus the producer's default currency that
  // seeds the create-form dropdown when the producer adds a service.
  let storefrontProducts: StorefrontProduct[] = [];
  let storefrontPublicUrl: string | null = null;
  let storefrontProducerName: string | null = null;
  let storefrontProducerSlug: string | null = null;
  let storefrontDefaultCurrency: Currency = "USD";
  if (active === "store") {
    const [packages, profile] = await Promise.all([
      caller.booking.packages.list(),
      caller.producer.me(),
    ]);
    storefrontProducts = packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      durationMin: p.durationMin,
      sessionCount: p.sessionCount,
      priceCents: p.priceCents,
      currency: p.currency,
      active: p.active,
      paymentPlans: p.paymentPlans,
      // Plan label is derived from paymentPlans. Single full plan =>
      // "Pay once"; single split => "50/50"; single monthly =>
      // "Monthly · N×"; multi => "N plans". Drives the chip on each
      // product card.
      planLabel: derivePlanLabel(p.paymentPlans),
      // Edit-form fields — the kebab → Edit menuitem now opens an
      // inline modal with NewPackageForm pre-filled, so the row needs
      // every column the form binds to.
      depositPct: p.depositPct,
      kind: p.kind,
      locationType: p.locationType,
      bufferMinutes: p.bufferMinutes,
      minLeadHours: p.minLeadHours,
      contractUrl: p.contractUrl,
    }));

    storefrontPublicUrl = profile.slug ? buildJoinUrl(profile.slug) : null;
    storefrontProducerName = profile.displayName;
    storefrontProducerSlug = profile.slug;
    // Narrow the producer's profile-level default currency to the
    // form-typed Currency union. Out-of-range values fall back to USD
    // — same defensive default as the form's own initial state.
    const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
    storefrontDefaultCurrency = (
      VALID_CURRENCIES as readonly string[]
    ).includes(profile.defaultCurrency)
      ? (profile.defaultCurrency as Currency)
      : "USD";
  }

  let portfolioTracks: PortfolioTrackRow[] = [];
  let externalLinks: ExternalLinkRow[] = [];
  let libraryRows: LibraryPickRow[] = [];
  // F9 — non-null audioUrls already in the producer's portfolio. The
  // picker uses this set to mark library rows as "Already added" so
  // the producer can't queue the same track twice. Paired with the
  // server-side dedup in portfolio.create.
  let addedAudioUrls: string[] = [];
  if (active === "portfolio") {
    const [tracks, links, library] = await Promise.all([
      caller.portfolio.list(),
      caller.producerExternalLinks.list(),
      caller.library.list(),
    ]);
    portfolioTracks = tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      isPublicSample: t.isPublicSample,
    }));
    addedAudioUrls = tracks
      .map((t) => t.audioUrl)
      .filter((u): u is string => Boolean(u));
    externalLinks = links.map((l) => ({
      id: l.id,
      platform: l.platform,
      url: l.url,
      title: l.title,
    }));
    libraryRows = library.map((r) => ({
      versionId: r.versionId,
      trackTitle: r.trackTitle,
      projectTitle: r.projectTitle,
      artistName: r.projectArtistName,
      audioUrl: r.audioUrl,
      uploadedAt: r.uploadedAt.toISOString(),
    }));
  }

  // Header subtitle: count line on Store, descriptive blurb on Portfolio.
  const subtitle =
    active === "store"
      ? `${String(storefrontProducts.length)} ${storefrontProducts.length === 1 ? "service" : "services"} available to book`
      : META[active].description;

  return (
    <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
      <header className="mb-5">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
          Storefront
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {subtitle}
        </p>
      </header>

      <ProfileTabs active={active} />

      <div
        key={active}
        id={`profile-panel-${active}`}
        aria-labelledby={`profile-tab-${active}`}
        className="pt-5"
      >
        {active === "store" && (
          <StorefrontScreen
            products={storefrontProducts}
            analytics={null}
            publicUrl={storefrontPublicUrl}
            producerName={storefrontProducerName}
            producerSlug={storefrontProducerSlug}
            defaultCurrency={storefrontDefaultCurrency}
          />
        )}
        {active === "portfolio" && (
          <PortfolioPanel
            tracks={portfolioTracks}
            links={externalLinks}
            library={libraryRows}
            addedAudioUrls={addedAudioUrls}
          />
        )}
      </div>
    </div>
  );
}
