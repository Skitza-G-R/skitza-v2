import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { ServicePackageRow } from "~/components/dashboard/setup/services-section";
import type { PortfolioTrackRow } from "~/components/dashboard/setup/portfolio-section";
import { appRouter } from "~/server/trpc/routers/_app";

import { ProfileTabs } from "./profile-tabs";
import { type ProfileTabKey, isProfileTab } from "./profile-tab-key";
import { StorePanel } from "./store-panel";
import {
  PortfolioPanel,
  type ExternalLinkRow,
  type LibraryPickRow,
} from "./portfolio-panel";

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

  // Store tab needs both the package list AND the producer's profile
  // default currency (the latter seeds the New-service form so it
  // matches the producer's locale instead of falling back to USD).
  // Fan out in parallel — the two calls are independent.
  let servicesPackages: ServicePackageRow[] = [];
  let storeDefaultCurrency: "USD" | "EUR" | "GBP" | "ILS" = "USD";
  if (active === "store") {
    const [packages, profile] = await Promise.all([
      caller.booking.packages.list(),
      caller.producer.me(),
    ]);
    servicesPackages = packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      durationMin: p.durationMin,
      sessionCount: p.sessionCount,
      priceCents: p.priceCents,
      currency: p.currency,
      depositPct: p.depositPct,
      active: p.active,
      kind: p.kind,
      locationType: p.locationType,
      bufferMinutes: p.bufferMinutes,
      minLeadHours: p.minLeadHours,
      paymentPlans: p.paymentPlans,
      contractUrl: p.contractUrl,
    }));
    storeDefaultCurrency = profile.defaultCurrency as
      | "USD"
      | "EUR"
      | "GBP"
      | "ILS";
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
      ? `${String(servicesPackages.length)} ${servicesPackages.length === 1 ? "service" : "services"} available to book`
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
          <StorePanel
            packages={servicesPackages}
            defaultCurrency={storeDefaultCurrency}
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
