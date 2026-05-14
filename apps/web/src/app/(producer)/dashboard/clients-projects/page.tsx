import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  ClientsListScreen,
  type ClientsListRow,
} from "~/components/dashboard/clients/clients-list-screen";
import {
  ProjectsList,
  type GroupedProjects,
  type ProjectRow,
  type Stage,
} from "~/components/dashboard/projects/projects-list";
import { isProjectState, type ProjectState } from "~/lib/projects/states";
import { formatMoney } from "~/lib/format/money";
import { appRouter } from "~/server/trpc/routers/_app";

import { ClientsPageTabs } from "./clients-page-tabs";
import { type ClientsTabKey, isClientsTab } from "./clients-tab-key";

// /dashboard/clients-projects — producer's "Clients & Projects"
// workspace. Two URL-driven tabs:
//
//   ?tab=projects (default)  → ProjectsList (one row per project,
//     grouped by display state Live / Done / Archived).
//   ?tab=clients             → ClientsListScreen (one card per
//     contact with rolled-up stats).
//
// 2026-05-06 redesign — page header now matches the founder's HTML
// mockup: "Clients & Projects" display title, rich subtitle (project
// counts + outstanding total), and a context-aware "+ New" CTA whose
// label changes with the active tab. Both views are sourced from
// `clientContacts.listWithProjects` so the rows can render real
// outstanding/lifetime/next-session numbers without a second fetch
// from the client.

type PageProps = {
  searchParams: Promise<{ tab?: string; state?: string }>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const sp = await searchParams;
  const active: ClientsTabKey = isClientsTab(sp.tab) ? sp.tab : "projects";

  // Two parallel calls — one fold per view. Cheap (Neon HTTP, both
  // producer-scoped, both indexed lookups) and lets the header show
  // accurate counts for whichever tab isn't currently rendered.
  const [projectsResult, clientsResult] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects({ view: "by-client" }),
  ]);

  // Group projects by stage for the ProjectsList client component.
  // The state filter (?state=) is read here and threaded down so
  // bookmarks like "?state=live" continue to work.
  const activeState: ProjectState | null = isProjectState(sp.state)
    ? sp.state
    : null;

  const clientGrouped: GroupedProjects = {
    lead: [],
    booked: [],
    in_production: [],
    final_review: [],
    paid: [],
    archived: [],
  };

  let totalOutstandingCents = 0;
  let activeProjectCount = 0;

  if (projectsResult.view === "all-projects") {
    for (const p of projectsResult.projects) {
      // The Stage type on v3-clean is the full visible set already
      // (lead / booked / in_production / final_review / paid / archived);
      // no runtime narrowing needed.
      const stage: Stage = p.stage;
      const updatedAt = p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt);
      const row: ProjectRow = {
        id: p.id,
        title: p.title,
        artistName: p.client.name,
        stage,
        updatedAtIso: updatedAt.toISOString(),
        outstandingCents: p.outstandingCents,
        nextSessionAtIso: p.nextSessionAt?.toISOString() ?? null,
        unresolvedComments: p.unresolvedComments,
        currency: p.currency,
      };
      clientGrouped[stage].push(row);
      totalOutstandingCents += p.outstandingCents;
      if (p.isActive) activeProjectCount += 1;
    }
  }

  const clientRows: ClientsListRow[] =
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
            totalProjectCount: c.totalProjectCount,
            activeProjectCount: c.activeProjectCount,
            outstandingCents: c.outstandingCents,
            lifetimeCents: c.lifetimeCents,
            // outstandingCents/lifetimeCents on the contact aggregate
            // are summed across project rows without currency
            // normalization. v1 treats every client as USD; per-client
            // currency is deferred (see Phase 4 handoff).
            currency: "USD",
            needsAttention: c.needsAttention,
            isStale: c.isStale,
            lastActivityIso: last.toISOString(),
          };
        })
      : [];

  const totalProjectCount = Object.values(clientGrouped).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  // Display currency for the "$X outstanding" tagline. Picks the
  // most-common currency across the producer's projects to avoid a
  // per-row currency lookup; falls back to USD when there's nothing.
  const displayCurrency = pickDominantCurrency(clientGrouped, "USD");

  // CTA destination + label switch on the active tab. Today both go
  // to the new-project flow because the new-client surface doesn't
  // exist yet — that's a fast-follow.
  const ctaHref = "/dashboard/clients-projects/new";
  const ctaLabel = active === "clients" ? "+ New client" : "+ New project";

  return (
    <>
      <div className="relative isolate">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
        />
        <div className="sk-page-enter mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
          {/* HTML-mockup header — display title, rich subtitle with
              counts + outstanding, context-aware CTA. */}
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
                Workspace
              </p>
              <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-[rgb(var(--fg-default))] sm:text-5xl">
                Clients &amp; Projects
              </h1>
              <p className="mt-2 text-[13px] text-[rgb(var(--fg-muted))]">
                <span className="sk-num font-mono tabular-nums">
                  {totalProjectCount.toString()}
                </span>{" "}
                project{totalProjectCount === 1 ? "" : "s"} ·{" "}
                <span className="sk-num font-mono tabular-nums">
                  {activeProjectCount.toString()}
                </span>{" "}
                active ·{" "}
                <span className="sk-num font-mono tabular-nums">
                  {clientRows.length.toString()}
                </span>{" "}
                client{clientRows.length === 1 ? "" : "s"}
                {totalOutstandingCents > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span
                      className="sk-num font-mono font-bold tabular-nums"
                      style={{ color: "rgb(var(--fg-danger))" }}
                    >
                      {formatMoney(totalOutstandingCents, displayCurrency)}
                    </span>{" "}
                    outstanding
                  </>
                ) : null}
              </p>
            </div>
            <Link
              href={ctaHref}
              className="sk-pop inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-base))] shadow-sm transition-transform hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
            >
              {ctaLabel}
            </Link>
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
              <ClientsListScreen rows={clientRows} />
            ) : (
              <ProjectsList grouped={clientGrouped} activeState={activeState} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function pickDominantCurrency(
  grouped: GroupedProjects,
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const list of Object.values(grouped)) {
    for (const r of list) {
      const c = r.currency ?? fallback;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
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
