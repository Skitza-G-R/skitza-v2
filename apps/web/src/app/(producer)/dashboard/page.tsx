import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import { dateKeyInTimeZone } from "~/components/dashboard/overview/overview-time";
import { ProofQueueRefresh } from "~/components/dashboard/requests/proof-queue-refresh";
import { appRouter } from "~/server/trpc/routers/_app";

import { detectOnboardingState } from "./onboarding/detect";

// Overview page — always renders the single responsive Calm Control
// screen. Its Needs You queue owns unresolved work; the other compact
// sections own their own empty states so a new producer still sees a
// useful dashboard scaffold.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";
  const showAllNeedsYou = sp.view === "all";

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

  // Fan-out across the independent sources that feed the dashboard's
  // Needs You queue, proof review, project/upload shelves, and studio pulse.
  const [
    today,
    me,
    followUpRaw,
    pendingBookings,
    pendingPurchaseRequests,
    pendingPaymentProofs,
    urgent,
    recentPaid,
  ] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.booking.needsFollowUp(),
    caller.booking.list({ status: "pending_approval" }),
    caller.producer.purchase.list({ status: "pending" }),
    caller.producer.purchase.proofOfPayment.pending(),
    caller.producer.overview.urgent({ limit: 50 }),
    caller.booking.recentPaidUnacknowledged(),
  ]);

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
  const producerTimezone = me.timezone || "UTC";
  const todaySession = (() => {
    const sessionItem = today.items.find((it) => it.kind === "session");
    if (!sessionItem) return null;
    const sessionDay = dateKeyInTimeZone(sessionItem.occurredAt, producerTimezone);
    if (sessionDay !== dateKeyInTimeZone(now, producerTimezone)) return null;
    return {
      id: sessionItem.id,
      title: sessionItem.title,
      subtitle: sessionItem.subtitle,
      occurredAt: sessionItem.occurredAt,
      href: sessionItem.href,
    };
  })();

  const pendingApprovals = pendingBookings.map((booking) => ({
    id: booking.id,
    artistName: booking.artistName,
    artistEmail: booking.artistEmail,
    startsAt: booking.startsAt,
    durationMin: booking.durationMin,
    packageNameSnapshot: booking.packageNameSnapshot,
    message: booking.notes,
  }));

  const paidBookings = recentPaid.map((payment) => ({
    id: payment.id,
    artistName: payment.artistName,
    packageNameSnapshot: payment.packageNameSnapshot,
    unitPriceCents: payment.unitPriceCents,
    songQty: payment.songQty,
    projectId: payment.projectId,
    projectName: payment.projectName,
  }));

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[260px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.08)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
      />
      <div className="mx-auto max-w-[1920px]">
        <ProofQueueRefresh />
        <OverviewScreen
          displayName={me.displayName}
          slug={me.slug}
          timezone={producerTimezone}
          pulseStats={today.pulseStats}
          paymentProofs={pendingPaymentProofs.available ? pendingPaymentProofs.proofs : []}
          purchaseRequests={pendingPurchaseRequests.requests}
          pendingApprovals={pendingApprovals}
          followUps={followUpRaw.map((session) => ({
            id: session.id,
            artistName: session.artistName,
            projectTitle: session.projectTitle,
            projectId: session.projectId,
            count: session.count,
          }))}
          payments={paidBookings}
          todaySession={todaySession}
          urgentProjects={urgent.items}
          recentUploads={today.recentUploads.map((upload) => ({
            versionId: upload.versionId,
            trackId: upload.trackId,
            title: upload.title,
            versionLabel: upload.versionLabel,
            uploadedAt: upload.uploadedAt,
            durationMs: upload.durationMs,
            projectId: upload.projectId,
            projectClientName: upload.projectClientName,
          }))}
          unresolvedItems={today.needsYouUnresolvedItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            subtitle: item.subtitle,
            occurredAt: item.occurredAt,
            href: item.href,
            unread: item.unread,
          }))}
          showSetupNudge={showSetupNudge}
          showAllNeedsYou={showAllNeedsYou}
          now={now}
        />
      </div>
    </div>
  );
}
