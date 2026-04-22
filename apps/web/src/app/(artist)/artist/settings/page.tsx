import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { LanguageSwitcher } from "~/components/shell/language-switcher";
import { SignOutButton } from "./sign-out-button";

// `/artist/settings` — the artist-side Settings page.
//
// 2026-04-22 — Task 17 Phase 3 (docs/audit-report.md + design brief).
// Gili's Q3 answer confirmed this is reached via the UserButton
// dropdown on BOTH mobile + desktop — no 5th bottom-nav tab (would
// cramp the 4 existing tabs on 360px). A "Settings" custom
// UserButton.Link is added in both the mobile header and the desktop
// sidebar's UserButton.
//
// What this page does today:
//   1. Account — links into Clerk's hosted user-profile via an explicit
//      "Manage account" button (the UserButton modal also covers this,
//      but a dedicated link gives users a familiar Settings-page target).
//   2. Language — reuses the existing LanguageSwitcher from the
//      producer shell. Same EN ↔ HE toggle, same cookie persistence.
//   3. Notification preferences — stubbed as "Coming soon" toggles.
//      Wiring to real per-user flags is roadmap S2.3 (bundled with
//      the Sentry + PostHog install).
//
// Server Component. Middleware + (artist)/layout.tsx already gate
// auth + role. The `auth()` check here is belt-and-braces for direct-
// render paths. No DB I/O — this is a shell-plus-client-components
// page; the LanguageSwitcher does its own client-side work.

export const metadata = { title: "Settings · Skitza" };

export default async function ArtistSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/artist/settings");

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? null;
  const displayName =
    user?.firstName ??
    (email ? email.split("@")[0] : null) ??
    "there";

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]">
          Settings
        </h1>
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Hi {displayName}, manage your account + preferences.
        </p>
      </header>

      {/* Account section */}
      <section
        aria-labelledby="settings-account"
        className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
      >
        <h2
          id="settings-account"
          className="font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          Account
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-[rgb(var(--fg-muted))]">Signed in as</dt>
            <dd className="font-mono text-[rgb(var(--fg-primary))]">
              {email ?? "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/user"
            className="inline-flex min-h-[40px] items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] px-4 py-2 font-mono text-[0.75rem] uppercase tracking-wider text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            Manage account →
          </Link>
          <SignOutButton />
        </div>
      </section>

      {/* Language section */}
      <section
        aria-labelledby="settings-language"
        className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
      >
        <h2
          id="settings-language"
          className="font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          Language
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
          Choose your preferred language. Affects the app UI only —
          your producer&apos;s content stays in its original language.
        </p>
        <div className="mt-4">
          <LanguageSwitcher collapsed={false} />
        </div>
      </section>

      {/* Notification preferences — stubbed */}
      <section
        aria-labelledby="settings-notifications"
        className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
      >
        <h2
          id="settings-notifications"
          className="font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          Notifications
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
          Choose what you&apos;d like to hear about.
        </p>
        <ul className="mt-4 space-y-3">
          {NOTIFICATION_PREFS.map((pref) => (
            <li
              key={pref.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-base))] px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm text-[rgb(var(--fg-primary))]">
                  {pref.label}
                </p>
                <p className="text-xs text-[rgb(var(--fg-muted))]">
                  {pref.description}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-[rgb(var(--border-subtle))] px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                Coming soon
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// Notification preference stubs — rendered as "Coming soon" pills
// until the notifications data layer lands. The labels match the
// kinds the ArtistNotificationBell will eventually surface.
const NOTIFICATION_PREFS = [
  {
    id: "new-mix",
    label: "New mix uploaded",
    description: "Your producer shared a new version.",
  },
  {
    id: "session-confirmed",
    label: "Session confirmed",
    description: "Your booking is locked in.",
  },
  {
    id: "payment-received",
    label: "Payment received",
    description: "We processed a payment from you.",
  },
  {
    id: "producer-message",
    label: "New message from producer",
    description: "Replies on tracks + direct notes.",
  },
] as const;
