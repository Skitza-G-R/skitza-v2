import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";
import { StripeCard } from "./stripe-card";

// The settings page lives under /dashboard/* so it inherits the (app)
// layout's onboarding gate — which means the producer row is guaranteed
// to exist before render. We still re-derive userId here because Server
// Components don't inherit request-scoped context across route groups.
export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const profile = await caller.producer.me();

  return (
    <AppShell active="setup">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up mb-10">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Settings
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Your studio, dialed in.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Identity, currency, and brand. Changes take effect on your next page load — no
            rebuild needed.
          </p>
        </header>

        <SettingsForm
          profile={{
            displayName: profile.displayName ?? "",
            slug: profile.slug,
            defaultCurrency: profile.defaultCurrency as "USD" | "EUR" | "GBP" | "ILS",
            timezone: profile.timezone,
            brand: profile.brand,
          }}
        />

        <StripeCard
          connected={profile.stripeConnected}
          chargesEnabled={profile.stripeChargesEnabled}
        />

        <section className="mt-12 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6">
          <header className="mb-4">
            <h2 className="font-display text-xl tracking-tight">Your data</h2>
            <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
              Download everything Skitza has about you — profile, tracks, leads, magic links,
              and all analytics — as a single JSON file.
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
        </section>
      </div>
    </AppShell>
  );
}
