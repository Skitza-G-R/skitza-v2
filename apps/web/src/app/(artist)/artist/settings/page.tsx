import { auth, currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";
import { Wordmark } from "~/components/nav/wordmark";
import { DisconnectProducerButton } from "~/components/artist/disconnect-producer-button";

// Polished Settings — mirrors the locked design's:
//   - "Settings." hero
//   - Profile card (avatar + name + email + joined-date)
//   - Connected producers list (one row per studio)
//   - Settings rows (GCal, Payment method, Notifications, Time zone)
//   - Wordmark + version stamp footer
//
// We delegate "Sign out" + name/email/photo edits to Clerk's
// UserButton in the top bar (per CLAUDE.md `<Settings>` is account-
// adjacent, not account-itself). The integrations list keeps the
// "coming soon" pill from the prior implementation.
export default async function ArtistSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [user, { studios }] = await Promise.all([
    currentUser(),
    appRouter.createCaller({ userId }).artist.studios(),
  ]);

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.username ||
    "Artist";
  const email = user?.primaryEmailAddress?.emailAddress ?? "—";
  const initials = initialsOf(fullName);
  const joined = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : null;

  const settingsRows: { label: string; sub: string; soon: boolean }[] = [
    {
      label: "Google Calendar sync",
      sub: "Mirror your sessions to your personal calendar",
      soon: true,
    },
    {
      label: "Payment method",
      sub: "Add a card for instant payment",
      soon: true,
    },
    { label: "Notifications", sub: "Email · push · in-app", soon: true },
    { label: "Time zone", sub: "Detected automatically", soon: true },
  ];

  return (
    <div className="reveal-up space-y-4 pb-12">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          Settings
          <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
      </header>

      {/* Profile card */}
      <section
        aria-labelledby="profile-heading"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)]"
      >
        <h2 id="profile-heading" className="sr-only">
          Profile
        </h2>
        <div className="flex items-center gap-3">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full font-display text-xl font-extrabold text-[rgb(var(--fg-onsidebar))]"
              style={{
                background:
                  "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
              }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-[rgb(var(--fg-default))]">
              {fullName}
            </p>
            <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
              {email}
            </p>
            {joined ? (
              <p className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                Joined {joined}
              </p>
            ) : null}
          </div>
          {/* Account menu — Clerk handles name / email / photo / sign out
              behind the standard avatar drop-down. We render it inline
              here in addition to the top-bar copy so the affordance is
              also discoverable from the Settings tab. */}
          <UserButton
            appearance={{
              elements: {
                avatarBox:
                  "h-9 w-9 ring-1 ring-[rgb(var(--border-subtle))]",
              },
            }}
          />
        </div>
      </section>

      {/* Connected producers */}
      <section
        aria-labelledby="producers-heading"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
      >
        <h2
          id="producers-heading"
          className="px-4 pb-1 pt-4 font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]"
        >
          Connected producers · {studios.length}
        </h2>
        {studios.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-[rgb(var(--fg-secondary))]">
            No producers yet. Once a producer invites you, they'll show
            up here.
          </p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
            {studios.map((s) => (
              <li
                key={s.producerId}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                {s.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.logoUrl}
                    alt=""
                    className="h-8 w-8 rounded-[var(--radius-sm)] object-cover"
                  />
                ) : (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] font-display text-xs font-extrabold text-[rgb(var(--fg-onsidebar))]"
                    style={{
                      background:
                        "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
                    }}
                  >
                    {initialsOf(s.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                    {s.name}
                  </p>
                  <p className="truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
                    {s.slug}
                  </p>
                </div>
                <DisconnectProducerButton
                  producerId={s.producerId}
                  producerName={s.name}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Integrations / preferences */}
      <section
        aria-labelledby="prefs-heading"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
      >
        <h2 id="prefs-heading" className="sr-only">
          Preferences
        </h2>
        <ul>
          {settingsRows.map((row, idx) => (
            <li
              key={row.label}
              className={`flex items-center gap-3 px-4 py-3.5 ${idx > 0 ? "border-t border-[rgb(var(--border-subtle))]" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                  {row.label}
                </p>
                <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {row.sub}
                </p>
              </div>
              {row.soon ? (
                <span
                  className="rounded-[var(--radius-lg)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  coming soon
                </span>
              ) : (
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  →
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Footer wordmark + build stamp */}
      <div className="px-1 pt-4 text-center">
        <Wordmark size={16} />
        <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          artist · v1.0
        </p>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}
