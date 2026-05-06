import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardEmptyOnboarding } from "~/components/dashboard/today/empty-onboarding";
import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { appRouter } from "~/server/trpc/routers/_app";

import { detectOnboardingState } from "./onboarding/detect";
import { isDayOneEmpty } from "./page-helpers";

// Phase 4 — Overview rebuild.
//
// Replaces the Story 06 layout (DashboardGreeting → InboxSection →
// RecentUploadsShelf → PulseCard → ContextualActions) with the locked
// design's mobile-first hierarchy (per `notes/producer-screens.jsx`):
//   1. Hero — date eyebrow + name with amber period + status line
//   2. Pending Approvals card (conditional on booking.list pending count)
//   3. Today's Session card (conditional on first session item being today)
//   4. Money split row — Earned + open-items count
//   5. Activity feed — first 5 today.items
//
// The auth + skipper-nudge + day-1 empty-state flow is preserved
// (auth-fix is in flight on PR #60 — Phase 4 keeps its hands off
// role/auth logic). FinishSetupNudge + DashboardEmptyOnboarding
// branches still render above the populated layout when applicable.
//
// All page-level data is server-fetched via the tRPC server caller —
// no new procedures, no schema changes. Outstanding-balance
// aggregation is currently surfaced as `pulseStats.unresolvedItems`
// (count of unpaid invoices + open comments); a real
// `outstandingCents` aggregation is deferred to a follow-up that can
// touch producer.today safely.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";

  // First-run redirect — preserved from Story 06.
  const onboarding = await detectOnboardingState(userId);
  if (onboarding.firstRun && !skipOnboarding) {
    redirect("/dashboard/onboarding");
  }

  const caller = appRouter.createCaller({ userId });

  // Fan-out: today payload, profile, follow-up sessions (post-session
  // banner), pending approvals, and project-level urgent rows (the
  // Overview's Urgent card — replaces the old today.items-derived
  // urgency strip). All independent reads run in parallel.
  const [today, me, followUpRaw, pendingBookings, urgent] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.booking.needsFollowUp(),
    caller.booking.list({ status: "pending" }),
    caller.producer.overview.urgent(),
  ]);

  // Drop sessions that aren't yet linked to a project — without a
  // projectId we have nowhere to send the producer when they click
  // through, so the banner would be a dead-end.
  const followUpSessions = followUpRaw.filter(
    (s): s is typeof s & { projectId: string } => s.projectId !== null,
  );

  // Public origin used by DashboardEmptyOnboarding to render the
  // /join/<slug> URL. Always the canonical brand origin — share links
  // land in producer bios + socials, so they must always read as
  // `skitza.app/join/<slug>`. See `lib/share/public-url`.
  const publicBaseUrl = PUBLIC_BRAND_ORIGIN;

  // Show a "finish setup" nudge when a skipper hasn't set up any of
  // the basics yet AND has no inbox items — otherwise the dashboard
  // is completely empty with no next step to take.
  const showSetupNudge =
    skipOnboarding && !onboarding.hasPackages && today.items.length === 0;

  // Day-1 empty-state predicate. When ALL three counts are zero the
  // populated layout collapses to the empty-onboarding card. Same
  // signature as Story 06.
  const empty = isDayOneEmpty({
    recentUploadsCount: today.recentUploads.length,
    activeProjectsCount: today.pulseStats.activeProjects,
    itemsCount: today.items.length,
  });

  // Today's session = first session item whose occurredAt is today.
  // Producer.today fans the items list across sessions/comments/
  // invoices in priority order, so the first session row is also the
  // soonest one. We re-check the date to avoid surfacing a session
  // that's actually "tomorrow at 12:01am" as today's.
  const now = new Date();
  const todaySession = (() => {
    const sessionItem = today.items.find((it) => it.kind === "session");
    if (!sessionItem) return null;
    const sessionDay = sessionItem.occurredAt.toDateString();
    if (sessionDay !== now.toDateString()) return null;
    return {
      id: sessionItem.id,
      title: sessionItem.title,
      subtitle: sessionItem.subtitle,
      occurredAt: sessionItem.occurredAt,
      href: sessionItem.href,
    };
  })();

  // Reshape pending bookings for the approvals card. Only the fields
  // the card surfaces — drop the rest so the prop interface is
  // narrow and easy to follow. The schema column is `notes`; we
  // expose it as `message` to the screen since that's what the
  // design language calls it (the artist-side input field is
  // labelled "Your message").
  const pendingApprovals = pendingBookings.map((b) => ({
    id: b.id,
    artistName: b.artistName,
    artistEmail: b.artistEmail,
    startsAt: b.startsAt,
    durationMin: b.durationMin,
    packageNameSnapshot: b.packageNameSnapshot,
    message: b.notes,
  }));

  return (
    <>
      {/* Hero gradient + page chrome — preserved from Story 06. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.12)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px]">
          <h1 className="sr-only">Today</h1>

          {/* FinishSetupNudge fires above the day-1 empty state when
              both apply. Catching skippers before they bounce stays
              the highest-priority CTA. */}
          {showSetupNudge ? <FinishSetupNudge /> : null}

          {/* Post-session follow-up nudges. Confirmed sessions whose
              end time has passed while the project still sits in
              `booked` or `in_production`. Renders above the
              populated layout so it's the first thing a producer
              sees when there's stale work to close out. */}
          {followUpSessions.length > 0 ? (
            <div className="mx-4 mb-5 mt-5 space-y-2 sm:mx-6">
              {followUpSessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.06)] p-4"
                >
                  <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                    Session with {session.artistName} is done — how did it go?
                  </p>
                  <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                    {session.projectTitle}
                  </p>
                  <div className="mt-3 flex gap-3">
                    <Link
                      href={`/dashboard/clients-projects/${session.projectId}?tab=music`}
                      className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--brand-primary))] hover:underline"
                    >
                      Upload files →
                    </Link>
                    <Link
                      href={`/dashboard/clients-projects/${session.projectId}`}
                      className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))] hover:underline"
                    >
                      Update project →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Day-1 empty state */}
          {empty && !showSetupNudge ? (
            <div className="px-4 pt-6 pb-10 sm:px-6">
              <DashboardEmptyOnboarding
                slug={me.slug}
                publicBaseUrl={publicBaseUrl}
              />
            </div>
          ) : null}

          {/* Populated layout — Phase 4 OverviewScreen (Overview Polish) */}
          {!empty ? (
            <OverviewScreen
              displayName={me.displayName}
              slug={me.slug}
              pulseStats={today.pulseStats}
              pendingApprovals={pendingApprovals}
              todaySession={todaySession}
              urgentProjects={urgent.items}
              recentUploads={today.recentUploads.map((u) => ({
                versionId: u.versionId,
                trackId: u.trackId,
                title: u.title,
                versionLabel: u.versionLabel,
                uploadedAt: u.uploadedAt,
                durationMs: u.durationMs,
                projectId: u.projectId,
                projectClientName: u.projectClientName,
              }))}
              activity={today.items.map((it) => ({
                id: it.id,
                kind: it.kind,
                title: it.title,
                subtitle: it.subtitle,
                occurredAt: it.occurredAt,
                href: it.href,
                unread: it.unread,
              }))}
              now={now}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

// Soft onboarding banner for producers who skipped the wizard and
// haven't set up packages yet. Not a hard redirect — we just give
// them one prominent next step so an empty dashboard doesn't feel
// like a dead end.
function FinishSetupNudge() {
  return (
    <div
      role="status"
      className="mx-4 mt-5 mb-5 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.06)] p-4 sm:mx-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
          Two minutes to your first bookable link
        </p>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Add a service and your hours so clients can actually book you.
        </p>
      </div>
      <a
        href="/dashboard/onboarding"
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
      >
        Finish setup
      </a>
    </div>
  );
}
