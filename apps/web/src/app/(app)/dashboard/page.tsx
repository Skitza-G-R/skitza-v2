import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { QuickActions } from "~/components/dashboard/today/quick-actions";
import { RevenueTrend } from "~/components/dashboard/today/revenue-trend";
import { ShareLinkCard } from "~/components/dashboard/today/share-link-card";
import { TodayView, type TodayViewData } from "~/components/dashboard/today/today-view";
import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { detectOnboardingState } from "./onboarding/detect";

// Task 3: the producer's default landing is now "Today" — a KPI
// strip up top + a split-inbox below (list left, detail right on
// desktop; stack nav on mobile). Replaces the Kanban pipeline that
// lived here from Phase C.4 through Task 2. The Kanban files have
// been deleted; the Projects tab picks up the "all projects" list
// in Task 4.
//
// The onboarding first-run redirect stays — it's a separate concern
// from what-you-see-once-you're-set-up, and removing it would break
// the wizard flow that fresh sign-ups land in.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";

  // First-run redirect. `?skip=1` lets the producer bypass the
  // wizard — honored on both the redirect decision and the banner
  // state so power users can get straight in.
  const onboarding = await detectOnboardingState(userId);
  if (onboarding.firstRun && !skipOnboarding) {
    redirect("/dashboard/onboarding");
  }

  const caller = appRouter.createCaller({ userId });
  // Fetch the today payload, the producer profile, the project list,
  // and the 6-month revenue trend in parallel. ShareLinkCard needs
  // the slug; QuickActions needs the most-recent project id for
  // Upload/Invoice deep-links; RevenueTrend needs the 6 points.
  const [today, me, projectList, revenueTrend] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.project.list(),
    caller.producer.revenueTrend(),
  ]);

  // Public origin used by ShareLinkCard to render the /p/<slug> URL.
  // Falls back to the canonical Vercel deployment when NEXT_PUBLIC_SITE_URL
  // isn't configured (local dev). Matches the fallback chain in
  // getSiteUrl() over in server/stripe/client.ts.
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";

  // project.list is ordered by desc(updatedAt); take the first row that
  // isn't in a terminal state as the "most recent active". Producers
  // with only archived/cancelled projects fall through to null so the
  // Upload/Invoice quick-actions nudge them to create a new project.
  const mostRecentProject = projectList.find(
    (p) => p.stage !== "archived" && p.stage !== "cancelled",
  );
  const recentProjectId = mostRecentProject?.id ?? null;

  // Full share URL ready for Copy + Preview buttons. Null when the
  // producer hasn't picked a slug — QuickActions downgrades both
  // actions to disabled/tooltip in that case.
  const shareUrl = me.slug
    ? `${publicBaseUrl.replace(/\/$/, "")}/p/${me.slug}`
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

  // Dates cross the RSC → client boundary as ISO strings. We serialize
  // them here so the TodayView props stay a plain JSON shape — no
  // mystery revivers on the client side.
  const data: TodayViewData = {
    kpis: today.kpis,
    items: today.items.map((it) => ({
      id: it.id,
      kind: it.kind,
      title: it.title,
      subtitle: it.subtitle,
      occurredAtIso: it.occurredAt.toISOString(),
      href: it.href,
      unread: it.unread,
    })),
    savedViews: today.savedViews,
  };

  return (
    <AppShell active="today">
      {/* Batch C — Today goes full-bleed. A subtle radial brand
          gradient sits on top of the warm cream base so the upper
          fold glows with amber instead of looking like a bordered
          white card. The gradient fades to bg-base before the
          content reaches the fold, keeping the list + detail surface
          on a flat background (so typography, not framing, does the
          work). max-width lifts to 1920px for ultrawide producers; we
          still center below 1920 so the Samply-feel breathing room
          never degrades into an empty-gutter wasteland. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.12)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-8 pb-10 sm:px-8 lg:px-12 lg:pt-12">
          <h1 className="sr-only">Today</h1>
          {showSetupNudge ? <FinishSetupNudge /> : null}
          {/* Today Cockpit — the permanent share link sits ABOVE the KPI
              strip so it's the first thing in the producer's eye-line.
              The share-first workflow is the whole point of the Today
              screen; KPIs come second. */}
          <ShareLinkCard slug={me.slug} publicBaseUrl={publicBaseUrl} />
          {/* 8 time-saving actions — primary row (4 big buttons) +
              secondary row (4 chips). Lives between the share card and
              the KPI strip so frequent moves are never more than one
              click away. */}
          <QuickActions shareUrl={shareUrl} recentProjectId={recentProjectId} />
          {/* Revenue trend — compact SVG line chart showing the last
              6 months of paid-invoice revenue. Slots between the KPI
              strip (handled inside TodayView) and the inbox so the
              "how am I doing?" glance sits above the "what needs me?"
              list. Hidden entirely when the producer has no paid
              invoices in the window (component returns null). */}
          <div className="mt-8">
            <RevenueTrend
              points={revenueTrend.points}
              currency={revenueTrend.currency}
            />
          </div>
          <TodayView data={data} selectedItemId={selectedItemId} />
        </div>
      </div>
    </AppShell>
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
