import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import {
  AlbumSpace,
  type AlbumSpaceProject,
  type AlbumSpaceStudioLog,
} from "~/components/dashboard/project/album-space";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import type { TrackRowData } from "~/components/dashboard/project/track-row";
import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { toPaymentHistoryViewData } from "~/components/payments/payment-history-adapter";
import type { StudioLogEntry } from "~/components/dashboard/project/album-tabs/studio-log-tab";
import { buildProjectActivityEntries } from "~/components/dashboard/project/album-tabs/studio-log-activity";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
};

// Multi-song Project Space server component. The route keeps canonical
// project/payment reads and the Single-Space redirect server-side, then
// shapes the compact four-tab workspace for AlbumSpace.
//
// This server component:
//   1. Verifies auth.
//   2. Fetches project detail and purchase-owned bookings.
//   3. Reshapes the data into the AlbumSpace prop tree.
//   4. Renders <AlbumSpace>.
//
// Progress derivation: we don't have a per-stage % column yet, so we
// derive a project-wide progress heuristic from the workflow stage
// (brief=0, production=25, mixing=55, mastering=85, done=100). This
// keeps the bar visually meaningful for v1 — Phase 4 may replace it
// with a real per-song aggregation.

const STAGE_PROGRESS: Record<WorkflowStage, number> = {
  brief: 5,
  production: 30,
  mixing: 60,
  mastering: 85,
  done: 100,
};

function progressForStage(stage: WorkflowStage): number {
  return STAGE_PROGRESS[stage];
}

export default async function ProjectDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });

  const [detailResult, paymentResult] = await Promise.allSettled([
    caller.project.detail({ id }),
    caller.purchaseLedger.project({ projectId: id }),
  ]);
  if (detailResult.status === "rejected" || paymentResult.status === "rejected") {
    notFound();
  }
  const data = detailResult.value;
  const paymentModel = paymentResult.value;

  // Single-Space rule (DESIGN.md §2 + Phase 3 plan, decision 4) —
  // when a project has exactly one purchased space and it has been named,
  // the project IS that song. A still-empty paid single stays on this page
  // so its purchased space remains visible and actionable before audio.
  // We redirect the album route to the song route server-side so EVERY
  // entry point (clients list, client space, deep link, breadcrumb)
  // collapses to the same Song Space surface. Implemented BEFORE any
  // rendering so the AlbumSpace shell never lights up for single-song
  // projects.
  if (data.songSpaces.mode === "single" && data.tracks.length === 1 && data.tracks[0]) {
    redirect(`/dashboard/clients-projects/${id}/songs/${data.tracks[0].id}`);
  }

  // Sessions are needed only by Album Space. Keep this scoped read after
  // the Single-Space redirect so it cannot delay Song Space navigation.
  const projectBookings = await caller.booking.list({ projectId: id }).catch(() => []);

  const sessionEntries: StudioLogEntry[] = projectBookings.map((booking) => ({
    id: `session-${booking.id}`,
    kind: "session",
    ts: booking.startsAt,
    durationMinutes: booking.durationMin,
    attendees: [booking.artistName],
    status: booking.status,
  }));

  // Build the TrackRow data from the project.detail payload. For each
  // track we derive:
  //   - currentVersion: label of the latest version (versions already
  //     come back ordered newest-first).
  //   - noteCount: unresolved comments for this track's versions.
  //   - durationMs: from the latest version.
  //   - progress: heuristic per workflow stage (no per-track progress
  //     column yet).
  const tracks: TrackRowData[] = data.tracks.map((t) => {
    const trackVersions = data.versions.filter((v) => v.trackId === t.id);
    const latest = trackVersions[0];
    const noteIds = new Set(trackVersions.map((v) => v.id));
    const noteCount = data.comments.filter(
      (c) => noteIds.has(c.versionId) && c.resolvedAt === null,
    ).length;
    const stage: WorkflowStage = t.workflowStage;
    const base: TrackRowData = {
      id: t.id,
      title: t.title,
      artist: t.artist,
      workflowStage: stage,
      progress: progressForStage(stage),
    };
    if (latest?.label) base.currentVersion = latest.label;
    if (noteCount > 0) base.noteCount = noteCount;
    if (latest?.durationMs) base.durationMs = latest.durationMs;
    const playable = trackVersions.find((version) => version.audioUrl !== null);
    if (playable?.audioUrl) {
      base.playback = {
        versionId: playable.id,
        audioUrl: playable.audioUrl,
        versionLabel: playable.label,
        projectName: data.project.title,
        ...(typeof playable.durationMs === "number" ? { durationMs: playable.durationMs } : {}),
      };
    }
    // versionCount feeds the UploadTrackModal's "v{N+1}" default label.
    // Always set, even at 0, so the modal can pick "v1" deterministically.
    base.versionCount = trackVersions.length;
    return base;
  });

  // Project workflow is deliberately separate from per-song stages. The
  // producer edits this exact value from the project lifecycle controls;
  // individual song stages remain visible inside each Song Space.
  const projectStage: WorkflowStage = data.project.workflowStage;
  // Activity timeline — distilled from the project's event ledger.
  // We don't currently have a normalized activity table, so we
  // synthesize a small list from the strongest signals: project
  // creation, version uploads (newest 5), and resolved/unresolved
  // comments (newest 5). Phase 4 may persist a real `project_events`
  // log; this is enough for v1.
  const activities = buildProjectActivityEntries({
    projectId: data.project.id,
    projectCreatedAt: data.project.createdAt,
    versions: data.versions,
    comments: data.comments,
  });
  const studioLogEntries = [...activities, ...sessionEntries].sort(
    (left, right) => right.ts.getTime() - left.ts.getTime() || left.id.localeCompare(right.id),
  );

  const deadline = data.project.deadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(data.project.deadlineAt)
    : "No deadline";
  const now = new Date();
  const isOverdue =
    data.project.deadlineAt !== null &&
    data.project.deadlineAt < now &&
    data.project.lifecycleStatus !== "completed" &&
    data.project.lifecycleStatus !== "canceled";

  const project: AlbumSpaceProject = {
    id: data.project.id,
    name: data.project.title,
    clientName: data.project.clientName ?? data.project.artistName,
    songsCount: data.songSpaces.visibleCount,
    workflowStage: projectStage,
    deadline,
    isOverdue,
    paymentAttention: null,
  };
  const actionProject: ProjectActionProject = {
    id: data.project.id,
    title: data.project.title,
    clientName: data.project.clientName ?? data.project.artistName,
    lifecycleStatus: data.project.lifecycleStatus,
    workflowStage: data.project.workflowStage,
    deadlineAtIso: data.project.deadlineAt?.toISOString() ?? null,
    canDeleteEmptyDraft: data.canPermanentlyDelete,
  };
  const purchaseSummaries: ProjectPurchaseSummary[] = paymentModel.projects.flatMap(
    (paymentProject) =>
      paymentProject.purchases.map((purchase) => ({
        id: purchase.id,
        sourceKind: purchase.sourceKind,
        sourceLabel: purchase.commercialSnapshot.productOrOfferName,
        lifecycleStatus: purchase.lifecycleStatus,
        totalCents: purchase.totalCents,
        currency: purchase.currency,
        reference: purchase.refNumber,
        installments: purchase.installments.map((installment) => ({
          id: installment.id,
          position: installment.position,
          amountCents: installment.amountCents,
          currency: installment.currency,
          dueAtIso: installment.dueAt?.toISOString() ?? null,
          status: installment.status,
        })),
      })),
  );
  const paymentBucketPurchaseCount = (
    bucket: (typeof paymentModel.producerBuckets)["needs_review"],
  ) =>
    bucket.projects.reduce((count, paymentProject) => count + paymentProject.purchases.length, 0);
  const needsReviewPurchaseCount = paymentBucketPurchaseCount(
    paymentModel.producerBuckets.needs_review,
  );
  const dueOrOverduePurchaseCount = paymentBucketPurchaseCount(
    paymentModel.producerBuckets.due_or_overdue,
  );
  project.paymentAttention =
    needsReviewPurchaseCount + dueOrOverduePurchaseCount > 0
      ? { needsReviewPurchaseCount, dueOrOverduePurchaseCount }
      : null;

  const payments = {
    needsReview: toPaymentHistoryViewData(
      paymentModel.producerBuckets.needs_review,
      {
        id: "project-payment-needs-review",
        eyebrow: "Action needed",
        title: "Pending proofs",
        description: "Review payment proofs waiting on this project.",
        emptyTitle: "No proofs waiting",
        emptyDescription: "New payment proofs will appear here.",
      },
      "producer",
    ),
    dueOrOverdue: toPaymentHistoryViewData(
      paymentModel.producerBuckets.due_or_overdue,
      {
        id: "project-payment-outstanding",
        eyebrow: "Action needed",
        title: "Outstanding payments",
        description: "Due and overdue payments for this project.",
        emptyTitle: "Nothing due",
        emptyDescription: "Due and overdue payments will appear here.",
      },
      "producer",
    ),
    history: toPaymentHistoryViewData(
      paymentModel.producerBuckets.history,
      {
        id: "project-payment-history",
        eyebrow: "Completed record",
        title: "Payment history",
        description: "Completed agreements, payments, corrections, waivers, and cancellations.",
        emptyTitle: "No completed history",
        emptyDescription: "Completed payment records will appear here.",
      },
      "producer",
    ),
  };

  const studioLog: AlbumSpaceStudioLog = {
    entries: studioLogEntries,
  };

  // Stable ownership makes the producer-scoped client id authoritative.
  // Avoid rebuilding the entire Clients workspace just to recover it
  // from an email snapshot.
  const breadcrumbClientName = data.project.clientName ?? data.project.artistName;
  const breadcrumbClientCrumb = {
    label: breadcrumbClientName,
    href: `/dashboard/clients-projects/clients/${data.project.clientContactId}`,
  };

  return (
    <div
      className="sk-page-enter mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6"
      style={{ animationFillMode: "backwards" }}
    >
      <SetTopBarBreadcrumb crumbs={[breadcrumbClientCrumb, { label: data.project.title }]} />
      <AlbumSpace
        project={project}
        actionProject={actionProject}
        purchases={purchaseSummaries}
        payments={payments}
        tracks={tracks}
        emptySlots={data.songSpaces.emptySlots.map((slot) => ({
          id: slot.id,
          purchaseId: slot.purchaseId,
          label: slot.label,
        }))}
        addSongHref={`/dashboard/music?addSong=1&projectId=${data.project.id}&lockProject=1`}
        studioLog={studioLog}
      />
    </div>
  );
}
