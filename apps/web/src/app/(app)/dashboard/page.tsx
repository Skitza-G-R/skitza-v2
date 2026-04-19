import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

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
  const today = await caller.producer.today();

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
        <TodayView data={data} selectedItemId={selectedItemId} />
      </div>
    </AppShell>
  );
}
