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
import {
  ServicesSection,
  type ServicePackageRow,
} from "~/components/dashboard/setup/services-section";
import {
  isSetupSectionKey,
  type SetupSectionKey,
} from "~/components/dashboard/setup/setup-deeplink";
import { SETUP_SECTION_META } from "~/components/dashboard/setup/setup-headers";
import { SetupTabs } from "~/components/dashboard/setup/setup-tabs";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";
import { StripeCard } from "./stripe-card";

// Setup — the four-screen producer-dashboard consolidation. After the
// 2026-04-25 flatten, every tab renders its full management UI inline:
// Profile (SettingsForm), Services (ServicesSection — packages CRUD),
// Portfolio (PortfolioSection), Availability (AvailabilitySection —
// hours + blackouts + policies), Autopilot (AutopilotSection),
// Connections (StripeCard), Account (AccountSection inline below).
// No more cross-link "Manage X" buttons — those bounced to /dashboard/
// booking, which still exists for the read-only Weekly schedule + the
// Upcoming sessions list, but configuration now happens here.
//
// The page-level <h1> + description swap per active tab via
// SETUP_SECTION_META so producers always know what surface they're on
// without scanning back to the tab bar; the breadcrumb dropped because
// the dynamic title carries the same orientation.
//
// Stays a Server Component so we can await Clerk + the tRPC caller
// once per render. Tab-active data fetches are gated so each tab pays
// only for its own queries — fanning out everything would slow down
// the most-common landing tab (Profile).
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Parse + narrow the `?section=` param. Unknown values fall back to
  // "profile" — same defensive default as the old client-side
  // deeplink, just evaluated server-side now so we only render one
  // section.
  const resolvedSearchParams = await searchParams;
  const rawSection = resolvedSearchParams.section;
  const active: SetupSectionKey = isSetupSectionKey(rawSection)
    ? rawSection
    : "profile";

  const caller = appRouter.createCaller({ userId });

  // Profile data is always needed — it powers the Profile tab AND
  // feeds the Autopilot section (which reads `profile.autopilot`).
  // Other tab-specific queries fan out only when the matching tab is
  // active; gating keeps the cold-load cost of each tab bounded.
  const profile = await caller.producer.me();

  const portfolioTracks: PortfolioTrackRow[] =
    active === "portfolio"
      ? (await caller.portfolio.list()).map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          isPublicSample: t.isPublicSample,
        }))
      : [];

  const servicesPackages: ServicePackageRow[] =
    active === "services"
      ? (await caller.booking.packages.list()).map((p) => ({
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
        }))
      : [];

  // Availability tab needs three queries — fan them out in parallel
  // when active. The settings query has its own producer row read,
  // so this is 3 round-trips, not 1.
  let availabilityBlocks: AvailabilityBlock[] = [];
  let availabilityBlackouts: Blackout[] = [];
  let availabilitySettings: AvailabilitySettings = {
    defaultSessionMin: 60,
    autoConfirmBookings: false,
    cancellationPolicyHours: 24,
  };
  if (active === "availability") {
    const [blocks, blackouts, settings] = await Promise.all([
      caller.booking.availability.list(),
      caller.booking.blackouts.list(),
      caller.booking.availability.getSettings(),
    ]);
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

  const headerMeta = SETUP_SECTION_META[active];

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Centralized container card. Single source of visual
            identity for the whole Setup surface — the per-tab content
            renders flat inside (no nested heavy cards). The
            sk-card-glow primitive (in globals.css) layers a hairline
            border, a soft brand-tinted outer glow, and a subtle
            elevation drop-shadow restricted to the card boundary. */}
        <div className="sk-card-glow rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 py-5 sm:px-6 sm:py-6">
          <header className="reveal-up mb-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Setup
            </p>
            {/* H1 + description vary per active tab. Re-keying on the
                tab id replays reveal-up so the swap feels like a
                section transition, not a hard cut. */}
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

          <SetupTabs active={active} />

          {/* Only the active section renders. Keying the wrapper on
              `active` replays reveal-up on tab change so content slides
              in instead of hard-cutting. role="tabpanel" + aria-
              labelledby point back at the tab button for AT wiring. */}
          <div
            key={active}
            id={`setup-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`setup-tab-${active}`}
            className="reveal-up pt-4"
          >
          {active === "profile" && (
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
          )}

          {active === "services" && (
            <ServicesSection
              packages={servicesPackages}
              defaultCurrency={
                profile.defaultCurrency as "USD" | "EUR" | "GBP" | "ILS"
              }
            />
          )}

          {active === "portfolio" && (
            <PortfolioSection tracks={portfolioTracks} />
          )}

          {active === "availability" && (
            <AvailabilitySection
              blocks={availabilityBlocks}
              blackouts={availabilityBlackouts}
              settings={availabilitySettings}
            />
          )}

          {active === "autopilot" && (
            <AutopilotSection initial={profile.autopilot} />
          )}

          {active === "connections" && (
            <StripeCard
              connected={profile.stripeConnected}
              chargesEnabled={profile.stripeChargesEnabled}
            />
          )}

          {active === "account" && <AccountSection />}
          </div>
        </div>
      </div>
    </>
  );
}

// Account panel — data export + a hint about Clerk-managed email
// /password + replay tour. Two real subsections (Your data + Tour) so
// the inner h2/h3 stay; they distinguish subsections within this tab
// rather than re-stating the tab title (the page header does that).
// Renders flat inside the outer Setup container — no card frame.
function AccountSection() {
  return (
    <section aria-labelledby="setup-account-heading">
      <header className="mb-3">
        <h2
          id="setup-account-heading"
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
