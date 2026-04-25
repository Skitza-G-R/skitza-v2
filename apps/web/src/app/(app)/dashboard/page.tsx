import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ContextualActions } from "~/components/dashboard/today/contextual-actions";
import { DashboardGreeting } from "~/components/dashboard/today/dashboard-greeting";
import { DashboardEmptyOnboarding } from "~/components/dashboard/today/empty-onboarding";
import { InboxSection } from "~/components/dashboard/today/inbox-section";
import type { TodayListItem } from "~/components/dashboard/today/today-list";
import { PulseCard } from "~/components/dashboard/today/pulse-card";
import { RecentUploadsShelf } from "~/components/dashboard/today/recent-uploads-shelf";
import { appRouter } from "~/server/trpc/routers/_app";

import { detectOnboardingState } from "./onboarding/detect";
import { isDayOneEmpty } from "./page-helpers";

// Story 06 — Today page rebuild.
//
// Restructured render tree. The prior layout (ShareLinkCard hero →
// 8-button QuickActions → 4-KPI strip → 6-month chart → inbox below
// the fold) sat the producer's most-actionable surface (the inbox)
// below the fold. The redesign inverts that hierarchy in workflow
// order: greeting → inbox first → recent uploads middle → pulse +
// contextual actions bottom.
//
// Day-1 empty state: when the producer has no projects, no uploads,
// and no inbox items, the entire populated layout is replaced with
// a single centered onboarding card pointing at the share-link
// gateway. No wall of zeros. The populated layout returns
// automatically when any of those three counts go positive.
//
// FinishSetupNudge stays — it fires for skippers (producers who hit
// "skip" on the onboarding wizard but haven't set up packages yet),
// independent of the day-1 predicate.
//
// Hero gradient + max-w-[1920px] + sk-page-enter mount animation are
// preserved (the spec says only the content within is restructured).
// Share link surface lives in the sidebar footer now (Story 05's
// SidebarShareChip), not the page hero.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";

  // First-run redirect. `?skip=1` lets the producer bypass the wizard
  // — honored on both the redirect decision and the banner state so
  // power users can get straight in.
  const onboarding = await detectOnboardingState(userId);
  if (onboarding.firstRun && !skipOnboarding) {
    redirect("/dashboard/onboarding");
  }

  const caller = appRouter.createCaller({ userId });
  // Fetch the today payload + producer profile in parallel. The
  // project.list call from the prior layout is no longer needed —
  // ContextualActions' continue-track CTA reads from
  // today.recentUploads[0] (more current than project.updatedAt) and
  // send-invoice is gated on today.pulseStats.activeProjects alone.
  // revenueTrend also dropped — the deep 6-month chart moved to
  // /dashboard/revenue (Story 07) and Pulse renders its own ambient
  // sparkline from `today.pulseStats.sparkline`.
  const [today, me] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
  ]);

  // Public origin used by DashboardEmptyOnboarding to render the
  // /join/<slug> URL. Fallback chain matches getSiteUrl() over in
  // server/stripe/client.ts.
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";

  // Active projects count — drives the send-invoice fallback in
  // ContextualActions. The pulseStats payload is the canonical
  // source; using the same number keeps the actions algorithm in
  // sync with what the Pulse card's footer displays.
  const activeProjectsCount = today.pulseStats.activeProjects;

  // Full share URL — used by ContextualActions' share-link fallback.
  // Null when the producer hasn't picked a slug, in which case
  // ContextualActions surfaces the set-slug CTA instead.
  const shareUrl = me.slug
    ? `${publicBaseUrl.replace(/\/$/, "")}/join/${me.slug}`
    : null;

  // Show a "finish setup" nudge when a skipper hasn't set up any of
  // the basics yet AND has no inbox items — otherwise the dashboard
  // is completely empty with no next step to take.
  const showSetupNudge =
    skipOnboarding && !onboarding.hasPackages && today.items.length === 0;

  // Selected item comes from ?itemId. Only accept a single string —
  // an array here means the client tampered with the URL, and the
  // list component would have no sane way to render a multi-select
  // anyway.
  const selectedItemId = typeof sp.itemId === "string" ? sp.itemId : null;

  // Dates cross the RSC → client boundary as ISO strings. We
  // serialize them here so the InboxSection props stay a plain JSON
  // shape — no mystery revivers on the client side.
  const items: TodayListItem[] = today.items.map((it) => ({
    id: it.id,
    kind: it.kind,
    title: it.title,
    subtitle: it.subtitle,
    occurredAtIso: it.occurredAt.toISOString(),
    href: it.href,
    unread: it.unread,
  }));

  // Day-1 empty-state predicate. When ALL three counts are zero, the
  // whole populated layout collapses to a single onboarding card.
  // Skippers with the FinishSetupNudge active still get their nudge
  // — that banner fires above this block regardless.
  const empty = isDayOneEmpty({
    recentUploadsCount: today.recentUploads.length,
    activeProjectsCount,
    itemsCount: today.items.length,
  });

  return (
    <>
      {/* Hero gradient + page chrome — preserved from the prior
          layout. A subtle radial brand gradient sits on top of the
          warm cream base so the upper fold glows with amber instead
          of looking like a bordered white card. The gradient fades
          to bg-base before the content reaches the fold, keeping the
          subsequent surfaces on a flat background. max-width lifts
          to 1920px for ultrawide producers; we still center below
          1920 so the breathing room never degrades into an empty-
          gutter wasteland. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.12)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-8 pb-10 sm:px-8 lg:px-12 lg:pt-12">
          <h1 className="sr-only">Today</h1>

          {/* FinishSetupNudge fires above the day-1 empty state when
              both apply (skipper + nothing set up + empty inbox).
              Catching skippers before they bounce is the highest-
              priority CTA on the page, so it sits at the very top. */}
          {showSetupNudge ? <FinishSetupNudge /> : null}

          {/* Day-1 empty state — replaces the populated layout when
              the producer has no projects, no uploads, and no inbox
              items. FinishSetupNudge still renders above when the
              skipper predicate matches; the empty-onboarding card
              sits below it. */}
          {empty && !showSetupNudge ? (
            <DashboardEmptyOnboarding
              slug={me.slug}
              publicBaseUrl={publicBaseUrl}
            />
          ) : null}

          {/* Populated layout — renders unless the empty-state branch
              short-circuits above. The order matters: greeting →
              inbox → recent uploads → pulse → contextual actions.
              Spec locks this in __tests__/page-rebuild.test.ts. */}
          {!empty ? (
            // Single vertical-rhythm rule for the populated stack.
            // Per UX-critic on PR #48: replaces the prior per-component
            // `mb-*` salad (was `mb-8`, `mb-10`, `mb-6` across sections)
            // which made the page feel "made of components" rather than
            // "designed as a page." `space-y-12` lands a deliberate
            // 48-px gap between major sections — bigger than typical
            // card spacing so sections read as sections, not stacked
            // cards. The greeting still gets its own internal spacing
            // because it's a header, not a section peer.
            <div className="space-y-12">
              <DashboardGreeting
                unresolvedItems={today.pulseStats.unresolvedItems}
              />
              <InboxSection items={items} selectedItemId={selectedItemId} />
              <RecentUploadsShelf uploads={today.recentUploads} />
              <PulseCard stats={today.pulseStats} />
              <ContextualActions
                unresolvedItems={today.pulseStats.unresolvedItems}
                recentUploads={today.recentUploads}
                activeProjectsCount={activeProjectsCount}
                shareUrl={shareUrl}
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// Soft onboarding banner for producers who skipped the wizard and
// haven't set up packages yet. Not a hard redirect — they might have
// a reason for skipping — but we give them one prominent next step so
// an empty dashboard doesn't feel like a dead end.
function FinishSetupNudge() {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.06)] p-4 sm:flex-row sm:items-center sm:justify-between"
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
