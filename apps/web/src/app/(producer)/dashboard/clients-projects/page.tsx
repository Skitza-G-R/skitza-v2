import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  WorkspaceListView,
  type WorkspaceKPIs,
} from "~/components/dashboard/clients-projects/workspace-list-view";
import type { ProjectRowData } from "~/components/dashboard/projects/project-row";
import type { ClientCardData } from "~/components/dashboard/clients/client-card";
import { appRouter } from "~/server/trpc/routers/_app";

import {
  reorderClientsAction,
  reorderProjectsAction,
} from "./clients-actions";

// /dashboard/clients-projects — producer's "Clients & Projects"
// workspace. Phase 1 redesign (Task 16) — the page now renders a single
// <WorkspaceListView> which owns the KPI strip, tab switcher, filter
// chips, sort dropdown, layout switcher, and per-row drag-to-reorder
// handlers. The old tabs + list-screen composition was replaced as
// part of the big-bang visual rebuild.
//
// Two parallel fetches keep the wire-shape lean:
//   • listWithProjects({ view: "all-projects" }) — flat project rows
//     enriched with client identity (used for both project rows AND
//     KPI math: earnings / outstanding / needsAttention / next
//     deadline).
//   • listWithProjects({ view: "by-client" }) — per-client aggregates
//     for the Clients tab cards.
//   • producer.me() — only consumed for `slug` (so the Invite modal can
//     build skitza.app/invite/<slug>-<id>) and `defaultCurrency`.

// WorkspaceListView owns ?tab= / ?sort= / ?filter= as local state in
// Phase 1; URL hydration is a fast-follow. The one searchParam we DO
// hydrate is `?newProject=1` — the legacy /clients-projects/new route
// redirects here with that param so the modal auto-opens. (G7.)
type PageProps = {
  searchParams?: Promise<{ newProject?: string }>;
};

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = (await searchParams) ?? {};
  const autoOpenNewProject = sp.newProject === "1";

  const caller = appRouter.createCaller({ userId });

  // Two parallel calls — one fold per view. Cheap (Neon HTTP, both
  // producer-scoped, both indexed lookups). `productsList` is included
  // for the NewProjectModal product picker; the modal handles the
  // empty-state gracefully if the producer hasn't created any yet.
  const [projectsResult, clientsResult, me, productsList] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects({ view: "by-client" }),
    safeMe(caller),
    safeProducts(caller),
  ]);

  const producerSlug = me.slug ?? "";
  const producerCurrency = me.defaultCurrency;

  // ── Map project rows to the ProjectRowData shape ────────────────
  const projectRows: ProjectRowData[] =
    projectsResult.view === "all-projects"
      ? projectsResult.projects.map(toProjectRowData)
      : [];

  // ── Map client rows to the ClientCardData shape ─────────────────
  const clientRows: ClientCardData[] =
    clientsResult.view === "by-client"
      ? clientsResult.clients.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          // clerkUserId set ⇒ the artist signed up via the invite link
          // ("active"). Otherwise, invitedAt set ⇒ "pending" (amber
          // pulsing pill). Otherwise ⇒ "none" (the Invite-to-app CTA).
          linkState: c.clerkUserId
            ? ("active" as const)
            : c.invitedAt
              ? ("pending" as const)
              : ("none" as const),
          projects: c.activeProjectCount,
          lifetime: c.lifetimeCents,
          owed: c.outstandingCents,
          // Per-client currency isn't tracked in v1; the project rows'
          // dominant currency is the anchor (see header below).
          currency: producerCurrency,
          lastActivityIso:
            c.lastActivity instanceof Date
              ? c.lastActivity.toISOString()
              : new Date(c.lastActivity).toISOString(),
        }))
      : [];

  // ── KPIs ────────────────────────────────────────────────────────
  // Earnings: lifetime sum (paid projects' price). Outstanding: sum
  // across active projects. Needs attention: unresolved comments OR
  // non-zero balance on an active project. Next deadline: earliest
  // upcoming nextSessionAt across active projects.
  let earnings = 0;
  let outstanding = 0;
  let needsAttention = 0;
  let nextDeadlineAt: Date | null = null;
  if (projectsResult.view === "all-projects") {
    for (const p of projectsResult.projects) {
      earnings += p.lifetimeCents;
      outstanding += p.outstandingCents;
      if (
        p.unresolvedComments > 0 ||
        (p.outstandingCents > 0 && p.isActive)
      ) {
        needsAttention += 1;
      }
      if (p.nextSessionAt && p.isActive) {
        const at =
          p.nextSessionAt instanceof Date
            ? p.nextSessionAt
            : new Date(p.nextSessionAt);
        if (!Number.isNaN(at.getTime())) {
          if (!nextDeadlineAt || at < nextDeadlineAt) {
            nextDeadlineAt = at;
          }
        }
      }
    }
  }

  const displayCurrency = pickDominantCurrency(projectRows, producerCurrency);

  const kpis: WorkspaceKPIs = {
    earnings,
    outstanding,
    needsAttention,
    nextDeadline: formatDeadlineShort(nextDeadlineAt),
    currency: displayCurrency,
  };

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
      />
      <div className="sk-page-enter mx-auto max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
        <WorkspaceListView
          projects={projectRows}
          clients={clientRows}
          kpis={kpis}
          producerSlug={producerSlug}
          products={productsList}
          initialNewProjectOpen={autoOpenNewProject}
          onReorderProjects={reorderProjectsAction}
          onReorderClients={reorderClientsAction}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

// producer.me() can throw in edge cases (e.g. a producer row hiccup);
// the page should still render the list with sensible defaults.
async function safeMe(
  caller: ReturnType<typeof appRouter.createCaller>,
): Promise<{ slug: string | null; defaultCurrency: string }> {
  try {
    const row = await caller.producer.me();
    return { slug: row.slug, defaultCurrency: row.defaultCurrency };
  } catch (err) {
    console.warn("[clients-projects] producer.me failed", err);
    return { slug: null, defaultCurrency: "USD" };
  }
}

// Producer's active products for the NewProjectModal picker. Falls
// back to an empty list on any error — the modal renders an empty
// state hint pointing at /dashboard/store in that case. The mapping
// trims the wire shape down to exactly what the modal consumes.
async function safeProducts(
  caller: ReturnType<typeof appRouter.createCaller>,
): Promise<
  {
    id: string;
    name: string;
    description: string | null;
    deliverables: string[] | null;
    priceCents: number;
    currency: string;
    depositPct: number;
  }[]
> {
  try {
    const rows = await caller.booking.products.list();
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      deliverables: p.deliverables,
      priceCents: p.priceCents,
      currency: p.currency,
      depositPct: p.depositPct,
    }));
  } catch (err) {
    console.warn("[clients-projects] booking.products.list failed", err);
    return [];
  }
}

type EnrichedProject = {
  id: string;
  title: string;
  stage:
    | "lead"
    | "booked"
    | "in_production"
    | "final_review"
    | "paid"
    | "archived";
  client: { id: string | null; email: string; name: string };
  outstandingCents: number;
  currency: string;
  nextSessionAt: Date | null;
  unresolvedComments: number;
  isActive: boolean;
  updatedAt: Date | string;
};

// stage → progress %. Same heuristic the previous list view used so
// the scan rhythm doesn't shift when producers cross over.
const STAGE_PROGRESS: Record<EnrichedProject["stage"], number> = {
  lead: 12,
  booked: 30,
  in_production: 55,
  final_review: 80,
  paid: 100,
  archived: 100,
};

const STAGE_LABEL: Record<EnrichedProject["stage"], string> = {
  lead: "Lead",
  booked: "Booked",
  in_production: "In production",
  final_review: "Review",
  paid: "Done",
  archived: "Archived",
};

function toProjectRowData(p: EnrichedProject): ProjectRowData {
  // Tone: danger when there's a balance + active and no scheduled
  // session, warn when active w/ scheduled session, ok when paid,
  // neutral when archived. (Filter chips depend on this triage —
  // "urgent"=danger, "active"=warn|ok, "done"=neutral.)
  const tone: ProjectRowData["statusTone"] =
    p.stage === "archived"
      ? "neutral"
      : p.stage === "paid"
        ? "ok"
        : p.outstandingCents > 0 && !p.nextSessionAt
          ? "danger"
          : "warn";

  return {
    id: p.id,
    title: p.title,
    client: p.client.name,
    clientEmail: p.client.email,
    progress: STAGE_PROGRESS[p.stage],
    balance: p.outstandingCents,
    deadline: formatDeadlineShort(p.nextSessionAt),
    status: STAGE_LABEL[p.stage],
    statusTone: tone,
    currency: p.currency,
    updatedAtIso:
      p.updatedAt instanceof Date
        ? p.updatedAt.toISOString()
        : new Date(p.updatedAt).toISOString(),
    deadlineAtIso: p.nextSessionAt ? p.nextSessionAt.toISOString() : null,
  };
}

// Short deadline label: "3d" / "May 28" / "—".
function formatDeadlineShort(at: Date | null): string {
  if (!at) return "—";
  const now = Date.now();
  const diffMs = at.getTime() - now;
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return `${String(Math.abs(diffDays))}d ago`;
  if (diffDays <= 14) return `${String(diffDays)}d`;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(at);
  } catch {
    return "—";
  }
}

function pickDominantCurrency(
  rows: ReadonlyArray<{ currency?: string }>,
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.currency ?? fallback;
    counts.set(c, (counts.get(c) ?? 0) + 1);
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
