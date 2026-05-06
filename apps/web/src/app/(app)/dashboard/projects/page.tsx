import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  ClientsAndProjectsView,
  type ProjectsViewRow,
} from "~/components/dashboard/projects/clients-and-projects-view";
import { type ClientRow } from "~/components/dashboard/projects/clients-grid";
import { isProjectState } from "~/lib/projects/states";
import { appRouter } from "~/server/trpc/routers/_app";

// /dashboard/projects — the producer's "Clients & Projects" workspace.
// Owns the route-level data fetch, then hands the rich aggregate down
// to the client component. Two views toggle inside the client:
//
//   • Projects table — one row per project. Columns: badge, project,
//     client, progress, balance, deadline. Powered by
//     `clientContacts.listWithProjects({ view: "all-projects" })` so
//     `outstandingCents`, `lastActivity`, and the unresolved-comment
//     dot are all real (no client-side aggregation).
//
//   • Clients grid — one card per contact with rolled-up stats.
//     Powered by `clientContacts.listWithProjects({ view: "by-client" })`.
//
// Two parallel calls are intentionally redundant — the by-client view
// folds the same project rows into client aggregates, but we keep
// both fetches since each view runs server-side filters that can't be
// re-derived in the browser. Cheap on Neon (HTTP, single round-trip
// each, both producer-scoped).
//
// The `?state=` URL param continues to drive the Projects view's
// state filter (live / done / archived). It's read here and threaded
// into the client component as `activeState`.

type PageProps = {
  searchParams: Promise<{ state?: string }>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });

  const [projectsResult, clientsResult] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects({ view: "by-client" }),
  ]);

  const sp = await searchParams;
  const activeState = isProjectState(sp.state) ? sp.state : null;

  // Project rows — strip server-only fields, marshal Dates to ISO so
  // they cross the RSC → client boundary safely.
  const projects: ProjectsViewRow[] =
    projectsResult.view === "all-projects"
      ? projectsResult.projects.map((p) => ({
          id: p.id,
          title: p.title,
          stage: p.stage,
          // The aggregator always returns a `client` object — when the
          // CRM has no contact for the project's email it stubs in a
          // record using the project's artistName/clientName fallback.
          artistName: p.client.name,
          outstandingCents: p.outstandingCents,
          nextSessionAtIso: p.nextSessionAt?.toISOString() ?? null,
          lastActivityIso:
            (p.lastActivity instanceof Date
              ? p.lastActivity
              : new Date(p.lastActivity)
            ).toISOString(),
          currency: p.currency,
          unresolvedComments: p.unresolvedComments,
        }))
      : [];

  // Client rows — same marshaling treatment. `lastActivity` is always
  // truthy (the aggregator falls back to lastSeenAt when the project
  // join contributes nothing).
  const clients: ClientRow[] =
    clientsResult.view === "by-client"
      ? clientsResult.clients.map((c) => {
          const last =
            c.lastActivity instanceof Date
              ? c.lastActivity
              : new Date(c.lastActivity);
          return {
            id: c.id,
            email: c.email,
            name: c.name,
            activeProjectCount: c.activeProjectCount,
            totalProjectCount: c.totalProjectCount,
            outstandingCents: c.outstandingCents,
            lifetimeCents: c.lifetimeCents,
            unresolvedComments: c.unresolvedComments,
            lastActivityIso: last.toISOString(),
          };
        })
      : [];

  const totalOutstandingCents = projects.reduce(
    (sum, p) => sum + p.outstandingCents,
    0,
  );

  // Currency for display labels (Balance column, Owed/Lifetime stats).
  // Picks the most-common currency across the producer's projects to
  // avoid a per-row currency lookup; falls back to USD when there's
  // nothing to project from.
  const currency = pickDominantCurrency(projects, "USD");

  return (
    <div className="relative isolate">
      {/* Atmospheric gradient band at the top — subtle warmth that
          ties the workspace surface to the brand. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.08)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
      />
      <div className="sk-page-enter mx-auto max-w-[1400px] px-4 pt-8 pb-12 sm:px-6 lg:px-8 lg:pt-12">
        <ClientsAndProjectsView
          projects={projects}
          clients={clients}
          activeState={activeState}
          currency={currency}
          totalOutstandingCents={totalOutstandingCents}
        />
      </div>
    </div>
  );
}

function pickDominantCurrency(
  projects: ProjectsViewRow[],
  fallback: string,
): string {
  if (projects.length === 0) return fallback;
  const counts = new Map<string, number>();
  for (const p of projects) {
    counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  }
  let best = fallback;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}
