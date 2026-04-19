import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  ProjectsList,
  type GroupedProjects,
  type ProjectRow,
  type Stage,
} from "~/components/dashboard/projects/projects-list";
import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

// Task 4: lightweight browse view for all of a producer's projects,
// filterable by the seven Kanban-visible stages (lead → archived).
// Replaces the drag-drop columns that lived here from Phase C.4
// through Task 2 — per the design doc's anti-Kanban argument, the
// columns never earned the UI cost they took.
//
// Note: we deliberately do NOT run the first-run onboarding redirect
// here. /dashboard (the Today screen) owns that; users only reach
// /dashboard/projects once they've already started something, so the
// empty state below hints at sharing a magic link instead.

type PageProps = {
  searchParams: Promise<{ stage?: string }>;
};

// Allow-list of stage keys that match the router's `listByStage`
// buckets. Any other value in ?stage is ignored (falls back to "All").
const VALID_STAGES = new Set<Stage>([
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
]);

function coerceStage(input: string | undefined): Stage | null {
  if (!input) return null;
  return VALID_STAGES.has(input as Stage) ? (input as Stage) : null;
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const grouped = await caller.project.listByStage();
  const sp = await searchParams;
  const activeStage = coerceStage(sp.stage);

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
    <AppShell active="projects">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <header>
          <h1 className="font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]">
            Projects
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
            Browse and open the project room for any active engagement.
          </p>
        </header>
        <ProjectsList grouped={clientGrouped} activeStage={activeStage} />
      </div>
    </AppShell>
  );
}
