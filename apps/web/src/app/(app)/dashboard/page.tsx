import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { QuickActions } from "~/components/dashboard/today/quick-actions";
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
  // Fetch the today payload, the producer profile, and the project
  // list in parallel. ShareLinkCard needs the slug; QuickActions needs
  // the most-recent project id for Upload/Invoice deep-links.
  const [today, me, projectList] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.project.list(),
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
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
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
        <TodayView data={data} selectedItemId={selectedItemId} />
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
