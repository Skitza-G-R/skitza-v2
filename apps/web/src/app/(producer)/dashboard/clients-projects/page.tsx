import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  WorkspaceListView,
  type WorkspaceKPIs,
} from "~/components/dashboard/clients-projects/workspace-list-view";
import type { ProjectRowData } from "~/components/dashboard/projects/project-row";
import type { ClientCardData } from "~/components/dashboard/clients/client-card";
import { ProducerRuntimeSafeView } from "~/components/dashboard/runtime/producer-runtime-safe-view";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";
import { appRouter } from "~/server/trpc/routers/_app";

import { reorderProjectsAction } from "./clients-actions";

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
//   • producer.me() — consumed for `slug` (so the Invite modal can
//     build the verified artist signup URL) and the display currency.

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

  // Two producer-scoped folds plus the producer display settings.
  const [projectsResult, clientsResult, me] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects({ view: "by-client" }),
    safeMe(caller),
  ]);

  const producerSlug = me.slug ?? "";
  const producerCurrency = me.defaultCurrency;

  // ── Map project rows to the ProjectRowData shape ────────────────
  const projectRows: ProjectRowData[] =
    projectsResult.view === "all-projects" ? projectsResult.projects.map(toProjectRowData) : [];

  // ── Map client rows to the ClientCardData shape ─────────────────
  const clientRows: ClientCardData[] =
    clientsResult.view === "by-client"
      ? clientsResult.clients.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          notes: c.notes,
          tags: c.tags,
          archived: c.producerArchivedAt !== null,
          archiveBlockedReason:
            c.producerArchivedAt === null && c.archiveBlockingProjectCount > 0
              ? CLIENT_ARCHIVE_BLOCKED_MESSAGE
              : null,
          // clerkUserId set ⇒ the artist signed up via the invite link
          // ("active"). Otherwise, invitedAt set ⇒ "pending" (amber
          // pulsing pill). Otherwise ⇒ "none" (the Invite-to-app CTA).
          linkState: c.clerkUserId
            ? ("active" as const)
            : c.invitedAt
              ? ("pending" as const)
              : ("none" as const),
          projects: c.activeProjectCount,
          lifetime: c.commercial.lifetimeCents,
          owed: c.commercial.outstandingCents,
          needsAttention: c.needsAttention,
          currency: producerCurrency,
          lastActivityIso:
            c.lastActivity instanceof Date
              ? c.lastActivity.toISOString()
              : new Date(c.lastActivity).toISOString(),
          joinedAtIso:
            c.firstSeenAt instanceof Date
              ? c.firstSeenAt.toISOString()
              : new Date(c.firstSeenAt).toISOString(),
        }))
      : [];

  // ── KPIs ────────────────────────────────────────────────────────
  // Commercial totals fail closed until purchase payments provides the
  // canonical ledger projection. Needs attention is based only on
  // unresolved artist comments. Next deadline is the earliest explicit
  // project deadline across active work.
  let needsAttention = 0;
  let nextDeadlineAt: Date | null = null;
  let nextDeadlineProjectTitle: string | null = null;
  if (projectsResult.view === "all-projects") {
    for (const p of projectsResult.projects) {
      if (p.isActive && p.unresolvedComments > 0) {
        needsAttention += 1;
      }
      if (p.deadlineAt && p.isActive) {
        const at = p.deadlineAt instanceof Date ? p.deadlineAt : new Date(p.deadlineAt);
        if (!Number.isNaN(at.getTime())) {
          if (!nextDeadlineAt || at < nextDeadlineAt) {
            nextDeadlineAt = at;
            nextDeadlineProjectTitle = p.title;
          }
        }
      }
    }
  }

  const kpis: WorkspaceKPIs = {
    earnings: null,
    outstanding: null,
    needsAttention,
    nextDeadline: formatDeadlineShort(nextDeadlineAt),
    currency: producerCurrency,
    // Surface the project title on the Next deadline tile's sub line.
    // Spread-conditional keeps exactOptionalPropertyTypes happy when
    // there's no upcoming deadline at all.
    ...(nextDeadlineProjectTitle ? { nextDeadlineLabel: nextDeadlineProjectTitle } : {}),
  };

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[300px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-base))] to-[rgb(var(--bg-base))]"
      />
      <div className="sk-page-enter mx-auto max-w-[1400px] px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7">
        <ProducerRuntimeSafeView
          slot="producer.workspace.safe-view"
          data={{
            clientCount: clientRows.length,
            projectCount: projectRows.length,
            needsAttentionCount: needsAttention,
          }}
        />
        <WorkspaceListView
          projects={projectRows}
          clients={clientRows}
          kpis={kpis}
          producerSlug={producerSlug}
          initialNewProjectOpen={autoOpenNewProject}
          onReorderProjects={reorderProjectsAction}
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

type EnrichedProject = {
  id: string;
  title: string;
  lifecycleStatus: ProjectLifecycleStatus;
  workflowStage: ProjectRowData["workflowStage"];
  deadlineAt: Date | string | null;
  canPermanentlyDelete: boolean;
  client: { id: string | null; email: string; name: string };
  commercial: { outstandingCents: null };
  nextSessionAt: Date | null;
  unresolvedComments: number;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

const LIFECYCLE_PRESENTATION: Record<
  ProjectLifecycleStatus,
  { label: string; progress: number | null; tone: ProjectRowData["statusTone"] }
> = {
  waiting_for_payment: { label: "Waiting for payment", progress: null, tone: "warn" },
  active: { label: "Active", progress: null, tone: "ok" },
  paused: { label: "Paused", progress: null, tone: "warn" },
  completed: { label: "Archived · Completed", progress: 100, tone: "neutral" },
  canceled: { label: "Archived · Canceled", progress: null, tone: "neutral" },
};

function toProjectRowData(p: EnrichedProject): ProjectRowData {
  const lifecycle = LIFECYCLE_PRESENTATION[p.lifecycleStatus];
  const tone: ProjectRowData["statusTone"] =
    p.isActive && p.unresolvedComments > 0 ? "danger" : lifecycle.tone;

  return {
    id: p.id,
    title: p.title,
    lifecycleStatus: p.lifecycleStatus,
    workflowStage: p.workflowStage,
    client: p.client.name,
    clientEmail: p.client.email,
    progress: lifecycle.progress,
    balance: p.commercial.outstandingCents,
    deadline: formatDeadlineShort(p.deadlineAt),
    status: lifecycle.label,
    statusTone: tone,
    updatedAtIso:
      p.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date(p.updatedAt).toISOString(),
    createdAtIso:
      p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date(p.createdAt).toISOString(),
    deadlineAtIso: p.deadlineAt
      ? p.deadlineAt instanceof Date
        ? p.deadlineAt.toISOString()
        : new Date(p.deadlineAt).toISOString()
      : null,
    canPermanentlyDelete: p.canPermanentlyDelete,
  };
}

// Short deadline label: "3d" / "May 28" / "—".
function formatDeadlineShort(raw: Date | string | null): string {
  const at = raw instanceof Date ? raw : raw ? new Date(raw) : null;
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
