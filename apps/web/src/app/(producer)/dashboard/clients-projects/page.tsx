import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { WorkspaceListView } from "~/components/dashboard/clients-projects/workspace-list-view";
import type { ProjectRowData } from "~/components/dashboard/projects/project-row";
import type { ClientCardData } from "~/components/dashboard/clients/client-card";
import { clientInvitationLinkState } from "~/components/dashboard/clients/client-invitation-state";
import { ProducerRuntimeSafeView } from "~/components/dashboard/runtime/producer-runtime-safe-view";
import { RuntimeScreenSafeViewWriter } from "~/components/runtime-state/runtime-screen-view";
import { mapProducerWorkspaceSafeScreen } from "~/lib/runtime-state/screen-view-mappers";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";
import { appRouter } from "~/server/trpc/routers/_app";

import { ProjectsListFailure } from "./projects-list-failure";
import { ProjectsListLoading } from "./projects-list-loading";

// /dashboard/clients-projects — producer's combined Projects and Clients
// workspace. Projects opens first; the client roster remains secondary.
//
// One combined producer-scoped workspace fetch returns both the flat
// project rows and per-client aggregates. The router loads the shared
// project/comment/contact inputs once instead of repeating them for
// two separate views.
//   • producer.me() — consumed for `slug` (so the Invite modal can
//     build the verified artist signup URL) and the display currency.

// WorkspaceListView owns the bounded tab, view, sort, and search URL state.
// Manual New client / New project entry points were retired in SK-255:
// normal new work starts through the producer's public Skitza link, while
// existing work enters through Bring in active work.
export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <Suspense fallback={<ProjectsListLoading />}>
      <ProjectsPageContent userId={userId} />
    </Suspense>
  );
}

async function ProjectsPageContent({ userId }: { userId: string }) {
  const caller = appRouter.createCaller({ userId });

  const loadResult = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "workspace" }),
    safeMe(caller),
  ]).then(
    ([workspaceResult, me]) => ({ ok: true as const, workspaceResult, me }),
    (error: unknown) => {
      console.error("[clients-projects] workspace load failed", error);
      return { ok: false as const };
    },
  );
  if (!loadResult.ok || loadResult.workspaceResult.view !== "workspace") {
    return <ProjectsListFailure />;
  }
  const { workspaceResult, me } = loadResult;

  const producerSlug = me.slug ?? "";
  const producerCurrency = me.defaultCurrency;

  // ── Map project rows to the ProjectRowData shape ────────────────
  const projectRows: ProjectRowData[] = workspaceResult.projects.map(toProjectRowData);

  // ── Map client rows to the ClientCardData shape ─────────────────
  const clientRows: ClientCardData[] = workspaceResult.clients.map((c) => ({
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
    linkState: clientInvitationLinkState(c.invitationState),
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
  }));

  let needsAttention = 0;
  for (const p of workspaceResult.projects) {
    if (p.isActive && p.unresolvedComments > 0) {
      needsAttention += 1;
    }
  }

  return (
    <div className="relative isolate" data-gate1-meaningful-screen="clients-projects">
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
        <RuntimeScreenSafeViewWriter
          href="/dashboard/clients-projects"
          view={mapProducerWorkspaceSafeScreen({
            projects: projectRows,
            clients: clientRows,
            needsAttentionCount: needsAttention,
          })}
        />
        <WorkspaceListView
          projects={projectRows}
          clients={clientRows}
          producerSlug={producerSlug}
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
