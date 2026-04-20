import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { AutopilotSection } from "~/components/dashboard/setup/autopilot-section";
import {
  isSetupSectionKey,
  type SetupSectionKey,
} from "~/components/dashboard/setup/setup-deeplink";
import { SetupTabs } from "~/components/dashboard/setup/setup-tabs";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";
import { StripeCard } from "./stripe-card";

// Setup — the four-screen producer-dashboard consolidation of what used
// to be three separate routes (Settings, Portfolio, Booking/availability
// config). Post-Batch-A this page renders a proper tab bar (not a chip
// jump-bar over a long-scroll page): only the active section mounts,
// driven by `?section=<key>`. Legacy deep-links keep working — middleware
// redirects `/dashboard/portfolio` → `?section=portfolio` and the same
// Portfolio tab shows up as active.
//
// Six sections (profile default):
//   profile       — studio profile + brand (SettingsForm)
//   services      — cross-link to /dashboard/booking?tab=packages
//   portfolio     — cross-link to the public page (portfolio rehost
//                   lives behind a follow-up task — see TODO below)
//   availability  — cross-link to /dashboard/booking?tab=sessions
//   connections   — Stripe Connect (StripeCard)
//   account       — data export + Clerk-managed email/password
//
// Task 11 scope: Portfolio and Availability are cross-linked (not yet
// rehosted inline). The forms behind them are non-trivial — portfolio
// has file-upload + reorder actions, availability has a weekly grid
// editor + blackouts + timezone. A follow-up task will lift those in.
//
// The page stays a Server Component so we can await Clerk + the tRPC
// caller once per render. The tab bar is a client island purely because
// `next/link` + `aria-current` styling wants the pathname.
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Parse + narrow the `?section=` param. Unknown values fall back to
  // "profile" — same defensive default as the old client-side deeplink,
  // just evaluated server-side now so we only render one section.
  const resolvedSearchParams = await searchParams;
  const rawSection = resolvedSearchParams.section;
  const active: SetupSectionKey = isSetupSectionKey(rawSection)
    ? rawSection
    : "profile";

  const caller = appRouter.createCaller({ userId });
  const profile = await caller.producer.me();

  return (
    <AppShell active="setup">
      {/* Settings is a long-scroll page — on mobile, 40px of chrome
          above the first heading ate a noticeable chunk of viewport.
          py-6 mobile → sm:py-14 desktop keeps the editorial air on
          bigger screens while tightening the ratio of chrome-to-
          content on small ones. */}
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-14">
        <header className="reveal-up mb-6">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Setup
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Your studio, dialed in.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Everything that&rsquo;s not day-to-day client work — your identity,
            services, portfolio, hours, and payments — lives on one page.
          </p>
        </header>

        <SetupTabs active={active} />

        {/* Only the active section renders. Keying the wrapper on
            `active` replays the reveal-up animation on tab change so
            content slides in instead of hard-cutting — same pattern
            as ProjectSubTabs. `role="tabpanel"` + aria-labelledby
            point back at the tab button for AT wiring. */}
        <div
          key={active}
          id={`setup-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`setup-tab-${active}`}
          className="reveal-up pt-6"
        >
          {active === "profile" && (
            <SettingsForm
              profile={{
                displayName: profile.displayName ?? "",
                slug: profile.slug,
                defaultCurrency: profile.defaultCurrency as "USD" | "EUR" | "GBP" | "ILS",
                timezone: profile.timezone,
                brand: profile.brand,
              }}
            />
          )}

          {active === "services" && (
            <CrossLinkSection
              eyebrow="Services"
              title="What you sell"
              description="Each service is one thing clients can book — sessions, mixing, mastering, production days. Set a price, a duration, and a deposit rule."
              linkHref="/dashboard/booking?tab=packages"
              linkLabel="Manage services"
            />
          )}

          {active === "portfolio" && (
            <CrossLinkSection
              eyebrow="Portfolio"
              title="Your tracklist"
              description="The tracks that play on your public page. Leads land here first — give them a reason to stick around."
              linkHref={profile.slug ? `/p/${profile.slug}` : "/dashboard/settings?section=profile"}
              linkLabel={profile.slug ? "View your public page" : "Set a URL first"}
            />
          )}

          {active === "availability" && (
            <CrossLinkSection
              eyebrow="Availability"
              title={<>When you&rsquo;re open</>}
              description="Weekly hours, buffers between sessions, and blackout dates. Clients only see slots that fit inside these windows."
              linkHref="/dashboard/booking?tab=sessions"
              linkLabel="Edit hours & blackouts"
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
    </AppShell>
  );
}

// Account panel — data export + a hint about Clerk-managed
// email/password. We don't build our own credentials UI because
// Clerk's UserButton → "Manage account" modal does everything we'd
// otherwise have to re-implement.
function AccountSection() {
  return (
    <section
      aria-labelledby="setup-account-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
    >
      <header className="mb-4">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Account
        </p>
        <h2
          id="setup-account-heading"
          className="mt-2 font-display text-xl tracking-tight"
        >
          Your data
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Export everything we have on you — profile, tracks, leads, magic
          links, analytics — in a single JSON file.
        </p>
      </header>
      <a
        href="/api/export"
        className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
      >
        Download my data
      </a>
      <p className="mt-3 font-mono text-xs text-[rgb(var(--fg-muted))]">
        Secret token hashes are excluded — they&apos;re one-way and useless to you.
      </p>
      <p className="mt-6 text-xs text-[rgb(var(--fg-muted))]">
        Change email, password, or 2FA from the avatar menu (top-right) → Manage
        account.
      </p>
    </section>
  );
}

// Shared card for sections whose full rehost lives behind a follow-up
// task (Services / Portfolio / Availability). Same visual treatment as
// the existing Profile + Connections sections so the page doesn't feel
// stitched together. A small CTA button links to the existing surface
// so producers can still do the work — just via one more hop.
function CrossLinkSection({
  eyebrow,
  title,
  description,
  linkHref,
  linkLabel,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <section
      aria-labelledby={`setup-${eyebrow.toLowerCase()}-heading`}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
    >
      <header className="mb-4">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          {eyebrow}
        </p>
        <h2
          id={`setup-${eyebrow.toLowerCase()}-heading`}
          className="mt-2 font-display text-xl tracking-tight"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{description}</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={linkHref}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
        >
          {linkLabel}
        </Link>
      </div>
    </section>
  );
}
