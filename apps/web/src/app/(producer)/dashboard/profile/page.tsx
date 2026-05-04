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

  const headerMeta = META[active];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="sk-card-glow rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 py-5 sm:px-6 sm:py-6">
        <header className="reveal-up mb-4">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Profile
          </p>
          <h1
            key={`title-${active}`}
            className="reveal-up mt-1 font-display text-2xl leading-tight tracking-tight sm:text-3xl"
            style={{ fontVariationSettings: '"opsz" 36' }}
          >
            {headerMeta.title}
          </h1>
          <p
            key={`desc-${active}`}
            className="reveal-up mt-1.5 max-w-xl text-xs text-[rgb(var(--fg-secondary))]"
          >
            {headerMeta.description}
          </p>
        </header>

        <ProfileTabs active={active} />

        <div
          key={active}
          id={`profile-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`profile-tab-${active}`}
          className="reveal-up pt-4"
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
