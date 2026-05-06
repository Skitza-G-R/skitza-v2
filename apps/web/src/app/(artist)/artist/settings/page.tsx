import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ProducerAvatar } from "~/components/artist/producer-avatar";
import { appRouter } from "~/server/trpc/routers/_app";

// Settings — locked design system (Phase 5).
//
// Mobile: hero + Account card + Connected producers list +
// Integrations (Calendar / Payment) + version footer. Sign-out and
// account deletion live inside Clerk's <UserButton> menu (top-right
// of the artist shell) per CLAUDE.md i18n + auth scope decisions.
//
// Desktop: same content; rhythm widens via shell padding. The
// 220px section nav from `screens.artist-desktop-2.jsx` ships in a
// follow-up — Phase 5 keeps the section list flat so the same tree
// renders at both widths without a tab/route refactor.

export default async function ArtistSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [user, { studios }] = await Promise.all([
    currentUser(),
    caller.artist.studios(),
  ]);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    "Your account";
  const primaryEmail = user?.emailAddresses[0]?.emailAddress ?? null;

  return (
    <div className="space-y-6 pb-24 lg:space-y-8">
      <header className="reveal-up">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight lg:text-[44px] lg:leading-none">
          Settings<span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
      </header>

      {/* Account card */}
      <section
        aria-labelledby="account-heading"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
      >
        <p
          id="account-heading"
          className="sr-only"
        >
          Account
        </p>
        <div className="flex items-center gap-3.5">
          <ProducerAvatar name={displayName} size={56} className="text-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-[rgb(var(--fg-default))]">
              {displayName}
            </p>
            {primaryEmail ? (
              <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
                {primaryEmail}
              </p>
            ) : null}
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
              Manage in the account menu (top-right)
            </p>
          </div>
        </div>
      </section>

      {/* Connected producers */}
      <section
        aria-labelledby="producers-heading"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
      >
        <p
          id="producers-heading"
          className="px-5 pb-2 pt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Connected producers · {String(studios.length)}
        </p>
        {studios.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-[rgb(var(--fg-muted))]">
            You&rsquo;re not connected to any producers yet.
          </p>
        ) : (
          <ul>
            {studios.map((s, i) => (
              <li
                key={s.producerId}
                className={`flex items-center gap-3 px-5 py-3 ${
                  i < studios.length - 1
                    ? "border-t border-[rgb(var(--border-subtle))]"
                    : "border-t border-[rgb(var(--border-subtle))]"
                }`}
              >
                <ProducerAvatar name={s.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                    {s.name}
                  </p>
                  <p className="truncate font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                    skitza.app/p/{s.slug}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Integrations */}
      <section
        aria-labelledby="integrations-heading"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
      >
        <p
          id="integrations-heading"
          className="px-5 pb-2 pt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Integrations
        </p>
        <ul>
          <SettingsRow
            title="Google Calendar"
            sub="Mirror your sessions to your personal calendar."
            soon
          />
          <SettingsRow
            title="Payment method"
            sub="Add a card for instant payment."
            soon
          />
          <SettingsRow
            title="Notifications"
            sub="Email · push · in-app"
          />
          <SettingsRow
            title="Time zone"
            sub="Auto-detected from your device"
            last
          />
        </ul>
      </section>

      <div className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Skitza · artist · v1
        </p>
      </div>
    </div>
  );
}

function SettingsRow({
  title,
  sub,
  soon,
  last,
}: {
  title: string;
  sub: string;
  soon?: boolean;
  last?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 px-5 py-3.5 ${
        last ? "border-t" : "border-t border-b"
      } border-[rgb(var(--border-subtle))]`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
          {title}
        </p>
        <p className="truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {sub}
        </p>
      </div>
      {soon ? (
        <span className="pill pill-neutral shrink-0">coming soon</span>
      ) : (
        <span aria-hidden className="text-[rgb(var(--fg-muted))]">
          →
        </span>
      )}
    </li>
  );
}
