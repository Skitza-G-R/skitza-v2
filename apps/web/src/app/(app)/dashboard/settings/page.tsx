import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { SettingsForm } from "./settings-form";

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
    <AppShell active="overview">
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
      </div>
    </AppShell>
  );
}
