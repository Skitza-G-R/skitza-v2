import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import { PaymentReceivedBanner } from "~/components/dashboard/payment-received-banner";
import { appRouter } from "~/server/trpc/routers/_app";

import { detectOnboardingState } from "./onboarding/detect";

// Overview page — always renders <OverviewScreen>. Each section owns
// its own empty state (PublicLinkStrip when slug set, "Nothing urgent"
// row, "All quiet" activity message, $0 financial pulse), so a fresh
// producer who just finished onboarding sees the full dashboard
// scaffold with their public link front-and-centre.
//
// FinishSetupNudge (skipper-specific) and the post-session follow-up
// banner render above the layout when applicable.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";

  // Why no auto-redirect to /dashboard/onboarding here:
  // requireRole("producer") in (producer)/layout.tsx already routes
  // genuinely-new producers (no displayName) to /onboarding/welcome —
  // the canonical May-2026 flow. A second derived-state gate on
  // /dashboard (the previous `firstRun = no packages && empty brand`
  // check) re-fired on every visit because there's no persistent
  // "onboarding seen" flag, trapping producers who finished the real
  // wizard but hadn't yet added a package or brand. detectOnboardingState
  // still runs below to power the skipper banner.
  const onboarding = await detectOnboardingState(userId);

  const caller = appRouter.createCaller({ userId });

  // Fan-out: today payload, profile, follow-up sessions (post-session
  // banner), pending approvals, project-level urgent rows (the
  // Overview's Urgent card — replaces the old today.items-derived
  // urgency strip), and SK-20's recent-paid-unacknowledged bookings
  // (drives the payment-received banner above OverviewScreen). All
  // independent reads run in parallel.
  const [today, me, followUpRaw, pendingBookings, urgent, recentPaid] =
    await Promise.all([
      caller.producer.today(),
      caller.producer.me(),
      caller.booking.needsFollowUp(),
      caller.booking.list({ status: "pending_approval" }),
      caller.producer.overview.urgent(),
      caller.booking.recentPaidUnacknowledged(),
    ]);

  // Drop sessions that aren't yet linked to a project — without a
  // projectId we have nowhere to send the producer when they click
  // through, so the banner would be a dead-end.
  const followUpSessions = followUpRaw.filter(
    (s): s is typeof s & { projectId: string } => s.projectId !== null,
  );

  // Show a "finish setup" nudge when a skipper hasn't set up any of
  // the basics yet AND has no inbox items — otherwise the dashboard
  // is completely empty with no next step to take.
  const showSetupNudge =
    skipOnboarding && !onboarding.hasPackages && today.items.length === 0;

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

          {/* FinishSetupNudge fires for producers who used `?skip=1`
              from onboarding and haven't added packages yet. Top of
              the page so it stays the highest-priority CTA. */}
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

          {/* SK-20 — payment-received banner. Stacks below the
              followUpSessions block and above OverviewScreen so all
              "above-layout system banners" share one vertical lane.
              Per-row dismiss runs through the payment-banner server
              action which revalidates this page. */}
          <PaymentReceivedBanner
            bookings={recentPaid.map((p) => ({
              id: p.id,
              artistName: p.artistName,
              packageNameSnapshot: p.packageNameSnapshot,
              unitPriceCents: p.unitPriceCents,
              songQty: p.songQty,
              projectId: p.projectId,
              projectName: p.projectName,
            }))}
          />

          {/* Overview — always renders. Each section handles its own
              empty state. The PublicLinkStrip inside OverviewScreen
              gives a fresh producer the same share-your-link CTA the
              old day-1 takeover card was built for, but inline with
              the full dashboard scaffold around it. */}
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
