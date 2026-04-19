import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { SetupDeeplink } from "~/components/dashboard/setup/setup-deeplink";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";
import { StripeCard } from "./stripe-card";

// Setup — the four-screen producer-dashboard consolidation of what used
// to be three separate routes (Settings, Portfolio, Booking/availability
// config). One page, six anchored sections, deep-linkable via
// `?section=<key>`:
//
//   profile       — studio profile + brand (SettingsForm)
//   services      — cross-link to /dashboard/booking?tab=packages
//   portfolio     — cross-link to the public page (portfolio rehost
//                   lives behind a follow-up task — see TODO below)
//   availability  — cross-link to /dashboard/booking?tab=availability
//   connections   — Stripe Connect (StripeCard)
//   account       — data export + Clerk-managed email/password
//
// Task 11 scope: Portfolio and Availability are cross-linked (not yet
// rehosted inline). The forms behind them are non-trivial — portfolio
// has file-upload + reorder actions, availability has a weekly grid
// editor + blackouts + timezone. A follow-up task will lift those in.
// For now the Setup page owns the deep-link entry points so legacy
// redirects (middleware.ts `/dashboard/portfolio → ?section=portfolio`)
// still land users on something purposeful.
//
// The page stays a Server Component so we can await Clerk + the tRPC
// caller once per render. SetupDeeplink is a client island that reads
// `useSearchParams` and scroll-focuses the matching section.
export default async function SetupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const profile = await caller.producer.me();

  return (
    <AppShell active="setup">
      <SetupDeeplink />
      {/* Settings is a long-scroll page — on mobile, 40px of chrome
          above the first heading ate a noticeable chunk of viewport.
          py-6 mobile → sm:py-14 desktop keeps the editorial air on
          bigger screens while tightening the ratio of chrome-to-
          content on small ones. */}
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-14">
        <header className="reveal-up mb-10">
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
            Identity, packages, portfolio, hours, payments. One page for everything
            that&apos;s not day-to-day client work.
          </p>
          <SectionJumpBar />
        </header>

        {/* 1. Profile — studio identity + brand. SettingsForm renders
            its own sub-sections (Studio profile + Brand) inside a
            single form so they share the sticky submit bar. Wrapping
            the whole form in one setup-section anchor is intentional —
            deep-links to "?section=profile" land on the combined block. */}
        <section
          data-setup-section="profile"
          aria-labelledby="setup-profile-heading"
          className="scroll-mt-8 rounded-[var(--radius-lg)]"
        >
          <h2 id="setup-profile-heading" className="sr-only">
            Profile
          </h2>
          <SettingsForm
            profile={{
              displayName: profile.displayName ?? "",
              slug: profile.slug,
              defaultCurrency: profile.defaultCurrency as "USD" | "EUR" | "GBP" | "ILS",
              timezone: profile.timezone,
              brand: profile.brand,
            }}
          />
        </section>

        {/* 2. Services — cross-link. Package catalog lives on the
            booking surface for now; lifting it here would drag the
            whole package editor (create/edit dialog, payment plans
            parser, activate/deactivate actions) with it. Follow-up. */}
        <CrossLinkSection
          anchor="services"
          eyebrow="Services"
          title="What you sell"
          description="Sessions, mixing, mastering, production days. Each package is one offering with its own price, duration, and deposit rule."
          linkHref="/dashboard/booking?tab=packages"
          linkLabel="Manage packages"
        />

        {/* 3. Portfolio — cross-link + empty-state copy. The public
            tracklist on /p/<slug> reads from the same portfolio data.
            TODO: rehost the full tracklist editor here in a follow-up
            (it needs audio upload + reorder wiring, both of which
            still exist in ~/server/trpc/routers/portfolio.ts). */}
        <CrossLinkSection
          anchor="portfolio"
          eyebrow="Portfolio"
          title="Your tracklist"
          description="The tracks that play on your public page. Leads land here first — give them a reason to stick around."
          linkHref={profile.slug ? `/p/${profile.slug}` : "/dashboard/settings?section=profile"}
          linkLabel={profile.slug ? "View public page" : "Set a URL first"}
          secondary={{
            label: "Manage tracks (coming soon)",
            disabled: true,
          }}
        />

        {/* 4. Availability — cross-link to the booking surface's
            Availability tab. The weekly hours grid + blackouts editor
            still live there. Moving them here is a follow-up task. */}
        <CrossLinkSection
          anchor="availability"
          eyebrow="Availability"
          title={<>When you&rsquo;re open</>}
          description="Weekly hours, buffers between sessions, and blackout dates. Clients only see slots that fit inside these windows."
          linkHref="/dashboard/booking?tab=availability"
          linkLabel="Edit hours & blackouts"
        />

        {/* 5. Connections — Stripe Connect only for now. Calendar
            integration is intentionally omitted; availability already
            covers the "don't double-book me" case via blackouts. */}
        <section
          data-setup-section="connections"
          aria-labelledby="setup-connections-heading"
          className="scroll-mt-8"
        >
          <h2 id="setup-connections-heading" className="sr-only">
            Connections
          </h2>
          <StripeCard
            connected={profile.stripeConnected}
            chargesEnabled={profile.stripeChargesEnabled}
          />
        </section>

        {/* 6. Account — data export + a hint about Clerk-managed
            email/password. We don't build our own credentials UI
            because Clerk's UserButton → "Manage account" modal does
            everything we'd otherwise have to re-implement. */}
        <section
          data-setup-section="account"
          aria-labelledby="setup-account-heading"
          className="mt-12 scroll-mt-8 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
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
              Download everything Skitza has about you — profile, tracks, leads, magic
              links, and all analytics — as a single JSON file.
            </p>
          </header>
          <a
            href="/api/export"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
          >
            Download export (.json)
          </a>
          <p className="mt-3 font-mono text-xs text-[rgb(var(--fg-muted))]">
            Token hashes are excluded — they&apos;re one-way and of no use to you.
          </p>
          <p className="mt-6 text-xs text-[rgb(var(--fg-muted))]">
            Email, password, and 2FA are managed from the avatar menu (top-right) →
            Manage account.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

// Inline table-of-contents chips under the page header. Each chip is
// a same-page link that bumps `?section=<key>` — SetupDeeplink picks
// it up, scrolls, and pulses the target. Using `<Link scroll={false}>`
// prevents Next.js from doing its own scroll-to-top on nav, which
// would fight our scroll-into-view.
function SectionJumpBar() {
  const items: readonly { key: string; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "services", label: "Services" },
    { key: "portfolio", label: "Portfolio" },
    { key: "availability", label: "Availability" },
    { key: "connections", label: "Connections" },
    { key: "account", label: "Account" },
  ];
  return (
    <nav aria-label="Setup sections" className="mt-6 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={`/dashboard/settings?section=${item.key}`}
          scroll={false}
          className="inline-flex items-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

// Shared card for sections whose full rehost lives behind a follow-up
// task (Services / Portfolio / Availability). Same visual treatment as
// the existing Profile + Connections sections so the page doesn't feel
// stitched together. A small CTA button links to the existing surface
// so producers can still do the work — just via one more hop.
function CrossLinkSection({
  anchor,
  eyebrow,
  title,
  description,
  linkHref,
  linkLabel,
  secondary,
}: {
  anchor: string;
  eyebrow: string;
  title: ReactNode;
  description: string;
  linkHref: string;
  linkLabel: string;
  secondary?: { label: string; disabled: true } | { href: string; label: string; disabled?: false };
}) {
  return (
    <section
      data-setup-section={anchor}
      aria-labelledby={`setup-${anchor}-heading`}
      className="mt-8 scroll-mt-8 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
    >
      <header className="mb-4">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          {eyebrow}
        </p>
        <h2
          id={`setup-${anchor}-heading`}
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
        {secondary ? (
          secondary.disabled ? (
            <span
              aria-disabled
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] px-2 font-mono text-xs text-[rgb(var(--fg-muted))]"
            >
              {secondary.label}
            </span>
          ) : (
            <Link
              href={secondary.href}
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-primary))]"
            >
              {secondary.label}
            </Link>
          )
        ) : null}
      </div>
    </section>
  );
}
