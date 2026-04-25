import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  ProjectsList,
  type GroupedProjects,
  type ProjectRow,
  type Stage,
} from "~/components/dashboard/projects/projects-list";
import { isProjectState } from "~/lib/projects/states";
import { appRouter } from "~/server/trpc/routers/_app";

// Task 4: lightweight browse view for all of a producer's projects,
// filterable by the three display states (Live / Done / Archived).
// Batch G collapsed the former 8-chip stage filter to a 3-chip
// state filter — the ProjectsList client does the grouping; this
// page just parses `?state=` and hands it down. The URL param was
// renamed from `stage` to `state` to match the user-visible surface;
// legacy `stage` query params fall through to "All" silently (not a
// real regression: bookmarks to specific stages were never a
// prominent flow).
//
// Note: we deliberately do NOT run the first-run onboarding redirect
// here. /dashboard (the Today screen) owns that; users only reach
// /dashboard/projects once they've already started something, so the
// empty state below hints at sharing a magic link instead.

type PageProps = {
  searchParams: Promise<{ state?: string }>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const grouped = await caller.project.listByStage();
  const sp = await searchParams;
  const activeState = isProjectState(sp.state) ? sp.state : null;

  // Project down to the minimal row shape the client component needs.
  // Dates cross the RSC → client boundary as ISO strings; we drop
  // sensitive + unused columns (shareTokenHash, stripe ids, etc.) so
  // they never ship to the browser.
  const clientGrouped: GroupedProjects = {
    lead: [],
    booked: [],
    contract_sent: [],
    in_production: [],
    final_review: [],
    paid: [],
    archived: [],
  };
  for (const stage of Object.keys(clientGrouped) as Stage[]) {
    clientGrouped[stage] = grouped[stage].map<ProjectRow>((p) => ({
      id: p.id,
      title: p.title,
      artistName: p.artistName,
      stage: p.stage,
      updatedAtIso: p.updatedAt.toISOString(),
    }));
  }

  return (
    <>
      {/* Batch C — Projects page picks up the same editorial canvas
          treatment as Today: full-bleed, gradient band at the top,
          display-font page title at 4xl→5xl, mono eyebrow above it. */}
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-8 pb-12 sm:px-8 lg:px-12 lg:pt-12">
          <header>
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Pipeline
            </p>
            <h1 className="mt-2 font-display text-4xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-5xl">
              Projects
            </h1>
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-[rgb(var(--fg-secondary))]">
              Browse and open the project room for any active engagement.
            </p>
          </header>
          <ProjectsList grouped={clientGrouped} activeState={activeState} />
        </div>
      </div>
    </>
  );
}
