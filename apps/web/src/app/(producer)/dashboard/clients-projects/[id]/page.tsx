import { notFound, redirect } from "next/navigation";
import { auth } from "~/server/auth/clerk-identity";

import {
  AlbumSpace,
  type AlbumSpaceProject,
  type AlbumSpaceStudioLog,
} from "~/components/dashboard/project/album-space";
import type { ProjectSongUploadData } from "~/components/dashboard/project/project-song-upload-controller";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import type { TrackRowData } from "~/components/dashboard/project/track-row";
import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { toPaymentHistoryViewData } from "~/components/payments/payment-history-adapter";
import type { StudioLogEntry } from "~/components/dashboard/project/album-tabs/studio-log-tab";
import { buildProjectActivityEntries } from "~/components/dashboard/project/album-tabs/studio-log-activity";
import { projectSongUploadHref } from "~/lib/clients/project-song-upload-href";
import { classifySongUploadPublicExposure } from "~/server/domain/song-publication/upload-exposure";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ song?: string; upload?: string }>;
};

// Project Space server component. The route keeps canonical project,
// payment, and session reads server-side, then shapes the compact
// four-tab workspace for AlbumSpace.
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

export default async function ProjectDetail({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const caller = appRouter.createCaller({ userId });

  const [detailResult, paymentResult, bookingsResult] = await Promise.allSettled([
    caller.project.detail({ id }),
    caller.purchaseLedger.project({ projectId: id }),
    caller.booking.list({ projectId: id }),
  ]);
  if (detailResult.status === "rejected" || paymentResult.status === "rejected") {
    notFound();
  }
  const data = detailResult.value;
  const paymentModel = paymentResult.value;
  const projectBookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : [];
  const durableVersionTrackIds = new Set(
    data.versions
      .filter((version) => version.audioUrl !== null || version.audioDeletedAt !== null)
      .map((version) => version.trackId),
  );
  const durableTracks = data.tracks.filter((track) => durableVersionTrackIds.has(track.id));
  const selectedTrack = query.song
    ? durableTracks.find((track) => track.id === query.song)
    : undefined;
  if (query.song && !selectedTrack) {
    notFound();
  }

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
  const tracks: TrackRowData[] = durableTracks.map((t) => {
    const trackVersions = data.versions.filter((v) => v.trackId === t.id);
    const latest = trackVersions[0];
    const playable = trackVersions.find(
      (version) => version.audioDeletedAt === null && version.audioUrl !== null,
    );
    const historical = trackVersions.find(
      (version) => version.audioUrl !== null || version.audioDeletedAt !== null,
    );
    const detailVersion = playable ?? historical;
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
      detailHref: detailVersion
        ? `/dashboard/music/${encodeURIComponent(detailVersion.id)}?from=${encodeURIComponent(
            data.project.id,
          )}`
        : projectSongUploadHref(data.project.id, t.id),
      detailPrefetch: detailVersion === undefined,
    };
    if (latest?.label) base.currentVersion = latest.label;
    if (noteCount > 0) base.noteCount = noteCount;
    if (latest?.durationMs) base.durationMs = latest.durationMs;
    if (playable?.audioUrl) {
      base.playback = {
        versionId: playable.id,
        audioUrl: playable.audioUrl,
        versionLabel: playable.label,
        projectName: data.project.title,
        ...(typeof playable.durationMs === "number" ? { durationMs: playable.durationMs } : {}),
      };
    }
    return base;
  });

  // Project workflow stays in the compact project header. Song rows open
  // the existing Music player page instead of rendering another workflow.
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
        timeZone: "UTC",
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
    songsCount: durableTracks.length,
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

  let selectedSongUpload: ProjectSongUploadData | null = null;
  if (selectedTrack && query.upload === "1") {
    const songVersions = data.versions.filter((version) => version.trackId === selectedTrack.id);
    const sharing = await caller.songPublication.producerState({
      trackId: selectedTrack.id,
    });

    selectedSongUpload = {
      id: selectedTrack.id,
      purchaseId: selectedTrack.purchaseId,
      title: selectedTrack.title,
      archivedAtIso: selectedTrack.archivedAt?.toISOString() ?? null,
      versionCount: songVersions.length,
      publicExposure: classifySongUploadPublicExposure(sharing),
    };
  }

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
        provenanceNotice:
          purchase.provenance.kind === "producer_import" ? purchase.provenance.notice : null,
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
        selectedSongUpload={selectedSongUpload}
        initialUploadOpen={query.upload === "1"}
        studioLog={studioLog}
      />
    </div>
  );
}
