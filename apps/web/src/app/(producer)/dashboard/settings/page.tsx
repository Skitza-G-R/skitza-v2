import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ReplayTourButton } from "~/components/shell/replay-tour-button";
import {
  AvailabilitySection,
  type AvailabilityBlock,
  type Blackout,
  type AvailabilitySettings,
} from "~/components/dashboard/setup/availability-section";
import { AutopilotSection } from "~/components/dashboard/setup/autopilot-section";
import {
  PortfolioSection,
  type PortfolioTrackRow,
} from "~/components/dashboard/setup/portfolio-section";
import { MarketingSection } from "~/components/dashboard/setup/marketing-section";
import {
  ServicesSection,
  type ServicePackageRow,
} from "~/components/dashboard/setup/services-section";
import {
  isSettingsBranchKey,
  isLegacySectionKey,
  LEGACY_SECTION_TO_BRANCH,
  type SettingsBranchKey,
} from "~/components/dashboard/setup/setup-deeplink";
import { SETTINGS_BRANCH_META } from "~/components/dashboard/setup/setup-headers";
import { SettingsBranches } from "~/components/dashboard/setup/settings-branches";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";
import { StripeCard } from "./stripe-card";

// /dashboard/settings — collapsed from 7 tabs into 2 branches per PRD
// v3 §4.6 ("Settings has 2 branches only: Profile and Integrations").
//
// PROFILE branch       — account identity (display name, slug,
//                        currency, timezone, brand colors/logo,
//                        portfolio image picks, account/data export).
// INTEGRATIONS branch  — operational config + payment processing
//                        (services CRUD, availability, autopilot
//                        rules, Stripe).
//
// LEGACY URL HANDLING. The 7-tab era used `?section=<key>`. Every
// known section key is rewritten to its new branch via
// LEGACY_SECTION_TO_BRANCH so existing bookmarks (and the in-app
// links from /today, contextual-actions, sidebar-share-chip,
// storefront-screen, and middleware redirects of /dashboard/portfolio
// etc.) keep landing on the right surface.
//
// Stays a Server Component so we can await Clerk + the tRPC caller
// once per render. Branch-specific data fetches are gated so each
// branch pays only for its own queries.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; section?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;

  // Resolve the active branch in this priority order:
  //   1. New `?branch=<key>` param (canonical)
  //   2. Legacy `?section=<key>` param → mapped via LEGACY_SECTION_TO_BRANCH
  //   3. Default to "profile" (the entry-point branch)
  //
  // When a legacy `?section=*` arrives we issue a server-side
  // redirect to the canonical `?branch=*` URL so the browser address
  // bar updates and any future shares carry the new key. This keeps
  // the 7-tab era bookmarks working without forking the URL space
  // long-term.
  const rawBranch = resolvedSearchParams.branch;
  const rawSection = resolvedSearchParams.section;

  if (rawBranch === undefined && isLegacySectionKey(rawSection)) {
    const target = LEGACY_SECTION_TO_BRANCH[rawSection];
    redirect(`/dashboard/settings?branch=${target}`);
  }

  const active: SettingsBranchKey = isSettingsBranchKey(rawBranch)
    ? rawBranch
    : "profile";

  const caller = appRouter.createCaller({ userId });

  // Profile data is always needed — the Profile branch reads it and
  // the Integrations branch reads `profile.autopilot` for the
  // automation switches and `profile.stripeConnected/.stripeChargesEnabled`
  // for the Stripe card. One query is cheaper than gating it.
  const profile = await caller.producer.me();

  // Branch-scoped data fetches. Profile branch needs portfolio
  // tracks (one of the identity-image surfaces); Integrations branch
  // needs services packages + availability windows. Both run their
  // queries in parallel via Promise.all when the matching branch is
  // active. Inactive branches skip every query.
  let portfolioTracks: PortfolioTrackRow[] = [];
  let servicesPackages: ServicePackageRow[] = [];
  let availabilityBlocks: AvailabilityBlock[] = [];
  let availabilityBlackouts: Blackout[] = [];
  let availabilitySettings: AvailabilitySettings = {
    defaultSessionMin: 60,
    autoConfirmBookings: false,
    cancellationPolicyHours: 24,
  };

  if (active === "profile") {
    const tracks = await caller.portfolio.list();
    portfolioTracks = tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      isPublicSample: t.isPublicSample,
    }));
  }

  if (active === "integrations") {
    const [packages, blocks, blackouts, settings] = await Promise.all([
      caller.booking.packages.list(),
      caller.booking.availability.list(),
      caller.booking.blackouts.list(),
      caller.booking.availability.getSettings(),
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
    availabilityBlocks = blocks.map((b) => ({
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
    }));
    availabilityBlackouts = blackouts.map((b) => ({
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      reason: b.reason,
    }));
    availabilitySettings = {
      defaultSessionMin: settings.defaultSessionMin,
      autoConfirmBookings: settings.autoConfirmBookings,
      cancellationPolicyHours: settings.cancellationPolicyHours,
    };
  }

  const headerMeta = SETTINGS_BRANCH_META[active];

  return (
    <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
      {/* Mobile-first chrome — Settings. with amber period (Syne 800),
          per-branch subtitle below. Mirrors Overview/Clients/Storefront
          hero pattern in the design system. */}
      <header className="mb-5">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
          Settings
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p
          key={`desc-${active}`}
          className="reveal-up mt-1.5 max-w-2xl text-[12.5px] text-[rgb(var(--fg-muted))]"
        >
          {headerMeta.title} · {headerMeta.description}
        </p>
      </header>

      <SettingsBranches active={active} />

      <div
        key={active}
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-branch-${active}`}
        className="reveal-up pt-5"
      >
        {active === "profile" && (
          <div className="space-y-10">
            <SettingsForm
              profile={{
                displayName: profile.displayName ?? "",
                slug: profile.slug,
                defaultCurrency: profile.defaultCurrency as
                  | "USD"
                  | "EUR"
                  | "GBP"
                  | "ILS",
                timezone: profile.timezone,
                brand: profile.brand,
              }}
            />

            {/* Portfolio image picks — PRD §4.6 places "image" inside
                Profile (account identity). Showcased tracks on the
                public join page render here so the producer manages
                them next to brand colors + logo. */}
            <BranchDivider title="Tracklist on your join page" />
            <PortfolioSection tracks={portfolioTracks} />

            {/* Marketing meta — the 4 stats under the hero on
                /join/<slug>. Curated freeform copy (genres tags,
                released/streams summaries, response-time picker).
                Each stat hides on the public page when blank. */}
            <BranchDivider title="Public profile copy" />
            <MarketingSection profile={profile.marketing} />

            {/* Account — data export, email/password hint, replay tour.
                Last block on the Profile branch because it's the
                least-frequent surface. */}
            <BranchDivider title="Account" />
            <AccountSection />
          </div>
        )}

        {active === "integrations" && (
          <div className="space-y-10">
            {/* Stripe — PRD §4.6 "Payment Clearing System". The first
                integration the producer touches because no money flows
                without it. */}
            <section aria-labelledby="settings-stripe-heading">
              <SectionHeading
                id="settings-stripe-heading"
                title="Payments"
                description="Stripe takes deposits and final payments. Skitza adds no platform fee — you keep everything minus Stripe's standard rates."
              />
              <StripeCard
                connected={profile.stripeConnected}
                chargesEnabled={profile.stripeChargesEnabled}
              />
            </section>

            {/* Services — what clients can book. Operational integration
                that lives here until the Storefront page (PRD v3 §4.5)
                ships. */}
            <BranchDivider title="Services" />
            <ServicesSection
              packages={servicesPackages}
              defaultCurrency={
                profile.defaultCurrency as "USD" | "EUR" | "GBP" | "ILS"
              }
            />

            {/* Availability — when clients can book. Lives here until
                the standalone Calendar page (PRD v3 §4.4) hosts it. */}
            <BranchDivider title="Availability" />
            <AvailabilitySection
              blocks={availabilityBlocks}
              blackouts={availabilityBlackouts}
              settings={availabilitySettings}
            />

            {/* Autopilot — automation rules Skitza runs on the
                producer's behalf (welcome emails, unpaid reminders,
                etc.). */}
            <BranchDivider title="Autopilot" />
            <AutopilotSection initial={profile.autopilot} />
          </div>
        )}
      </div>
    </div>
  );
}

// Compact mono-eyebrow + thin separator. Used to carve the long
// inline-scroll branches into readable chunks without nesting tabs.
function BranchDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        {title}
      </span>
      <span className="h-px flex-1 bg-[rgb(var(--border-subtle))]" />
    </div>
  );
}

// Section heading used by inline blocks (e.g. Stripe Payments) that
// need a heading + supporting copy of their own.
function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-3">
      <h2
        id={id}
        className="font-display text-base tracking-tight"
        style={{ fontWeight: 700 }}
      >
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
        {description}
      </p>
    </header>
  );
}

// Account panel — data export + a hint about Clerk-managed email
// /password + replay tour. Renders flat inside the Profile branch.
function AccountSection() {
  return (
    <section aria-labelledby="settings-account-heading">
      <header className="mb-3">
        <h2
          id="settings-account-heading"
          className="font-display text-base tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Your data
        </h2>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          Export everything we have on you in a single JSON file.
        </p>
      </header>
      <a
        href="/api/export"
        className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
      >
        Download my data
      </a>
      <p className="mt-2 text-[0.66rem] text-[rgb(var(--fg-muted))]">
        Secret token hashes are excluded — they&apos;re one-way and useless to you.
      </p>
      <p className="mt-4 text-[0.66rem] text-[rgb(var(--fg-muted))]">
        Change email, password, or 2FA from the avatar menu (top-right) → Manage
        account.
      </p>
      <hr className="my-4 border-t border-[rgb(var(--border-subtle))]" />
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-sm tracking-tight" style={{ fontWeight: 700 }}>
          Tour
        </h3>
        <p className="text-xs text-[rgb(var(--fg-secondary))]">
          Forgot where things live? Walk through the 4-screen orientation again.
        </p>
        <div className="mt-1">
          <ReplayTourButton />
        </div>
      </div>
    </section>
  );
}
