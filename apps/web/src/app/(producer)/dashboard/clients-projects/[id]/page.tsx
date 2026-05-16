import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import {
  AlbumSpace,
  type AlbumSpaceProject,
  type AlbumSpacePayments,
  type AlbumSpacePlayLatest,
  type AlbumSpaceStudioLog,
} from "~/components/dashboard/project/album-space";
import { stageOrder, type WorkflowStage } from "~/lib/clients/workflow-stage";
import type { TrackRowData } from "~/components/dashboard/project/track-row";
import type {
  MilestoneStatus,
  PaymentMilestone,
} from "~/components/dashboard/project/album-tabs/payments-tab";
import type {
  StudioLogActivity,
  StudioLogSession,
} from "~/components/dashboard/project/album-tabs/studio-log-tab";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
};

// Phase 2 — Album Page server component. The 5-sub-tab legacy stack
// (header + room-hero + stat-strip + sub-tabs + Overview/Music/Notes/
// Sessions/Files) has been replaced by a single <AlbumSpace> shell
// that owns the new IA: AlbumHero · AlbumStatStrip · AlbumTabs
// (Songs / Files / Payments / Studio Log).
//
// This server component:
//   1. Verifies auth.
//   2. Parallel-fetches project.detail + project.money + bookings.
//   3. Reshapes the data into the AlbumSpace prop tree.
//   4. Renders <AlbumSpace>.
//
// Progress derivation: we don't have a per-stage % column yet, so we
// derive a project-wide progress heuristic from the workflow stage
// (brief=0, production=25, mixing=55, mastering=85, done=100). This
// keeps the bar visually meaningful for v1 — Phase 4 may replace it
// with a real per-song aggregation.

const STAGE_PROGRESS: Record<WorkflowStage, number> = {
  brief:      5,
  production: 30,
  mixing:     60,
  mastering:  85,
  done:       100,
};

function progressForStage(stage: WorkflowStage): number {
  return STAGE_PROGRESS[stage];
}

export default async function ProjectDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });

  let data;
  try {
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  // Single-Space rule (DESIGN.md §2 + Phase 3 plan, decision 4) —
  // when a project has exactly one track, the project IS that song.
  // We redirect the album route to the song route server-side so EVERY
  // entry point (clients list, client space, deep link, breadcrumb)
  // collapses to the same Song Space surface. Implemented BEFORE any
  // rendering so the AlbumSpace shell never lights up for single-song
  // projects.
  if (data.tracks.length === 1 && data.tracks[0]) {
    redirect(
      `/dashboard/clients-projects/${id}/songs/${data.tracks[0].id}`,
    );
  }

  // Parallel: money + sessions list (filtered to this project).
  const [moneyResult, bookingsResult] = await Promise.allSettled([
    caller.project.money({ projectId: id }),
    caller.booking.list(),
  ]);

  const money =
    moneyResult.status === "fulfilled"
      ? moneyResult.value
      : {
          paidCents: 0,
          outstandingCents: 0,
          currency: data.project.currency ?? "USD",
          nextChargeAt: null as Date | null,
        };

  const projectBookings =
    bookingsResult.status === "fulfilled"
      ? bookingsResult.value.filter((b) => b.projectId === data.project.id)
      : [];

  // Sessions count + studio hours derived from this project's bookings.
  const sessionsList: StudioLogSession[] = projectBookings.map((b) => ({
    id: b.id,
    date: b.startsAt,
    durationMinutes: b.durationMin,
    attendees: [b.artistName],
  }));
  const studioHours =
    projectBookings.reduce((sum, b) => sum + b.durationMin, 0) / 60;
  const now = new Date();
  const thisMonthCount = projectBookings.filter((b) => {
    const d = b.startsAt;
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  // "Last session" must reflect a session that has actually happened —
  // not the max across future-scheduled bookings. booking.list returns
  // bookings ordered ascending by startsAt, so the last past booking
  // is the freshest historical session.
  const pastBookings = projectBookings.filter((b) => b.startsAt < now);
  const lastPast = pastBookings[pastBookings.length - 1];
  const lastSessionDate: Date | null = lastPast ? lastPast.startsAt : null;

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
      workflowStage: stage,
      progress: progressForStage(stage),
    };
    if (latest?.label) base.currentVersion = latest.label;
    if (noteCount > 0) base.noteCount = noteCount;
    if (latest?.durationMs) base.durationMs = latest.durationMs;
    // versionCount feeds the UploadTrackModal's "v{N+1}" default label.
    // Always set, even at 0, so the modal can pick "v1" deterministically.
    base.versionCount = trackVersions.length;
    return base;
  });

  // Project-wide progress: prefer the max stage among tracks (a project
  // with 1 mastered track + 2 in mixing is further along than the worst).
  // Falls back to project-level workflowStage when there are no tracks.
  const projectStage: WorkflowStage = data.project.workflowStage;
  const projectProgress =
    tracks.length === 0
      ? progressForStage(projectStage)
      : Math.max(
          ...tracks.map((t) => progressForStage(t.workflowStage)),
        );

  // Highest-order stage across tracks — drives the hero eyebrow.
  const headlineStage: WorkflowStage =
    tracks.length === 0
      ? projectStage
      : tracks.reduce<WorkflowStage>((best, t) => {
          return stageOrder(t.workflowStage) > stageOrder(best)
            ? t.workflowStage
            : best;
        }, "brief");

  // Build milestones from invoices for this project. The project
  // router doesn't currently expose invoice rows directly, so we
  // surface a slim list derived from money + invoice status counts.
  // Phase 4 will add a dedicated `project.milestones` procedure; until
  // then we render an empty list when there's nothing to show. We
  // collapse this to a single "Engagement total" row when there's a
  // paid balance so the panel renders with at least one milestone for
  // the producer to scan.
  const milestones: PaymentMilestone[] = [];
  if (money.paidCents > 0 || money.outstandingCents > 0) {
    const total = money.paidCents + money.outstandingCents;
    const status: MilestoneStatus =
      money.outstandingCents === 0 ? "paid" : "pending";
    milestones.push({
      id: `engagement-${data.project.id}`,
      label: "Engagement total",
      amountCents: total,
      status,
      date: data.project.paidAt,
    });
  }

  // Activity timeline — distilled from the project's event ledger.
  // We don't currently have a normalized activity table, so we
  // synthesize a small list from the strongest signals: project
  // creation, version uploads (newest 5), and resolved/unresolved
  // comments (newest 5). Phase 4 may persist a real `project_events`
  // log; this is enough for v1.
  const activities: StudioLogActivity[] = [];
  activities.push({
    id: `created-${data.project.id}`,
    kind: "created",
    ts: data.project.createdAt,
    description: "Project created",
  });
  for (const v of data.versions.slice(0, 5)) {
    activities.push({
      id: `version-${v.id}`,
      kind: "version",
      ts: v.uploadedAt,
      description: `New version uploaded — ${v.label}`,
    });
  }
  for (const c of data.comments.slice(0, 5)) {
    activities.push({
      id: `comment-${c.id}`,
      kind: "comment",
      ts: c.createdAt,
      description: `${c.authorName} left a note`,
    });
  }
  activities.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const trimmedActivities = activities.slice(0, 10);

  // Deadline + isOverdue — the project schema doesn't currently carry
  // a deadline column. Use nextChargeAt as the closest signal we have
  // (renders "—" when null). Phase 4 can wire a real deadline.
  const deadline = money.nextChargeAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(money.nextChargeAt)
    : "—";
  const isOverdue =
    money.nextChargeAt !== null && money.nextChargeAt < new Date() && money.outstandingCents > 0;

  // Per-song surfacing: append "× N songs" to the project's hero
  // title when songQty was set at checkout. Lets the producer see
  // exactly what the artist booked without opening the product
  // page or doing tier math.
  const projectName =
    data.project.songQty != null && data.project.songQty > 1
      ? `${data.project.title} × ${String(data.project.songQty)} songs`
      : data.project.title;

  const project: AlbumSpaceProject = {
    id: data.project.id,
    name: projectName,
    clientName: data.project.clientName ?? data.project.artistName,
    songsCount: data.tracks.length,
    sessionsCount: projectBookings.length,
    totalCents: data.project.totalAmountCents ?? money.paidCents + money.outstandingCents,
    currency: money.currency,
    workflowStage: headlineStage,
    progress: projectProgress,
    deadline,
    isOverdue,
    outstandingCents: money.outstandingCents,
  };

  const payments: AlbumSpacePayments = {
    paidCents: money.paidCents,
    outstandingCents: money.outstandingCents,
    currency: money.currency,
    nextChargeAt: money.nextChargeAt,
    milestones,
  };

  const studioLog: AlbumSpaceStudioLog = {
    sessionsCount: projectBookings.length,
    studioHours,
    thisMonthCount,
    lastSessionDate,
    activities: trimmedActivities,
    sessions: sessionsList,
  };

  // Newest playable version across the project — feeds the AlbumHero
  // "Play latest" CTA. data.versions arrives newest-first, so the
  // first row with a non-null audioUrl is the freshest playable one.
  // The hero stays in its disabled "Coming soon" state when this is
  // null (the album has no uploaded audio yet).
  const playableVersion = data.versions.find((v) => v.audioUrl !== null);
  const playLatest: AlbumSpacePlayLatest | null = playableVersion
    ? (() => {
        const track = data.tracks.find((t) => t.id === playableVersion.trackId);
        const songTitle = track?.title ?? data.project.title;
        const out: AlbumSpacePlayLatest = {
          versionId: playableVersion.id,
          // audioUrl was checked non-null above; narrow for TS.
          audioUrl: playableVersion.audioUrl as string,
          songTitle,
          versionLabel: playableVersion.label,
          projectName: data.project.title,
        };
        if (typeof playableVersion.durationMs === "number") {
          out.durationMs = playableVersion.durationMs;
        }
        return out;
      })()
    : null;

  return (
    <main className="sk-page-enter mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <AlbumSpace
        project={project}
        tracks={tracks}
        payments={payments}
        studioLog={studioLog}
        playLatest={playLatest}
      />
    </main>
  );
}
