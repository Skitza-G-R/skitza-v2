import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "~/components/ui/button";
import {
  ProjectsList,
  type GroupedProjects,
  type ProjectRow,
  type Stage,
} from "~/components/dashboard/projects/projects-list";
import { isProjectState, type ProjectState } from "~/lib/projects/states";
import { appRouter } from "~/server/trpc/routers/_app";

import { ClientsPageTabs } from "./clients-page-tabs";
import { type ClientsTabKey, isClientsTab } from "./clients-tab-key";
import { ClientsPanel, type ClientRow } from "./clients-panel";

// Task 4 + Task 3 (tabs): the page now has two tabs — Clients and
// Projects. The Projects tab preserves the existing browse view; the
// Clients tab is a CRM list (one row per contact, expand for projects).
// `?tab` is parsed first; default is "projects" for backward compat
// (existing bookmarks / sidebar links land on the projects view).

type PageProps = {
  searchParams: Promise<{ tab?: string; state?: string }>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const sp = await searchParams;
  const active: ClientsTabKey = isClientsTab(sp.tab) ? sp.tab : "projects";

  let clientRows: ClientRow[] = [];
  const clientGrouped: GroupedProjects = {
    lead: [],
    booked: [],
    in_production: [],
    final_review: [],
    paid: [],
    archived: [],
  };
  let activeState: ProjectState | null = null;

  if (active === "clients") {
    const res = await caller.clientContacts.listWithProjects({
      view: "by-client",
    });
    if (res.view === "by-client") {
      clientRows = res.clients.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
        totalProjectCount: c.totalProjectCount,
        activeProjectCount: c.activeProjectCount,
        needsAttention: c.needsAttention,
        isStale: c.isStale,
        lastActivityIso:
          c.lastActivity instanceof Date
            ? c.lastActivity.toISOString()
            : new Date(c.lastActivity).toISOString(),
      }));
    }
  } else {
    const grouped = await caller.project.listByStage();
    activeState = isProjectState(sp.state) ? sp.state : null;
    for (const stage of Object.keys(clientGrouped) as Stage[]) {
      clientGrouped[stage] = grouped[stage].map<ProjectRow>((p) => ({
        id: p.id,
        title: p.title,
        artistName: p.artistName,
        stage: p.stage,
        updatedAtIso: p.updatedAt.toISOString(),
      }));
    }
  }

  // Header counts: clients tab shows total + active. Projects tab
  // shows total projects across stages. Both render the design's
  // "X total · Y active" count line under the title.
  const headerCounts =
    active === "clients"
      ? `${String(clientRows.length)} total · ${String(
          clientRows.filter((r) => !r.isStale).length,
        )} active`
      : `${String(
          Object.values(clientGrouped).reduce((sum, list) => sum + list.length, 0),
        )} projects across stages`;

  return (
    <>
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1920px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
          {/* Phase 4 header — locked design's title-with-amber-period
              + counts subtitle. The "+ New project" CTA stays as a
              right-aligned anchor at the same row as the title so
              touch users can reach it without a long scroll. */}
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[34px]">
                Clients
                <span className="text-[rgb(var(--brand-primary))]">.</span>
              </h1>
              <p className="mt-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
                {headerCounts}
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/dashboard/clients-projects/new">+ New project</Link>
            </Button>
          </header>

          <div className="mt-5">
            <ClientsPageTabs active={active} />
          </div>

          <div
            key={active}
            id={`clients-panel-${active}`}
            aria-labelledby={`clients-tab-${active}`}
            className="pt-5"
          >
            {active === "clients" ? (
              <ClientsPanel rows={clientRows} />
            ) : (
              <ProjectsList grouped={clientGrouped} activeState={activeState} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
