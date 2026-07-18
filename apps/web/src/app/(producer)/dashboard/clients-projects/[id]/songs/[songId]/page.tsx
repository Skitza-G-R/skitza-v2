import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import {
  SongSpace,
  type SongSpaceClient,
  type SongSpaceProject,
  type SongSpaceSong,
} from "~/components/dashboard/song/song-space";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import type { SessionsTabSession } from "~/components/dashboard/song/song-tabs/sessions-tab";
import type { VersionRowVersionData } from "~/components/dashboard/song/version-row";
import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import type { LinkPillState } from "~/components/dashboard/clients/link-pill";
import { appRouter } from "~/server/trpc/routers/_app";

// Phase 3 — Song Space server component for
// /dashboard/clients-projects/[id]/songs/[songId].
//
// This page:
//   1. Verifies auth + awaits dynamic params {id, songId}
//   2. Parallel-fetches project.detail + booking.list +
//      clientContacts.listWithProjects (the last only to resolve the
//      LinkPill state for the Client snippet)
//   3. Locates the song in data.tracks → notFound() when missing
//   4. Decides album-vs-single mode from data.tracks.length === 1
//   5. Reshapes the data into the SongSpace prop tree
//   6. Renders <SongSpace>
//
// Per-song sessions: bookings.song_id was added in Phase 0, exposed
// via the booking.list select(). We filter the producer's bookings
// down to just those linked to BOTH this project AND this song.

type PageProps = {
  params: Promise<{ id: string; songId: string }>;
};

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

export default async function SongDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id, songId } = await params;

  const caller = appRouter.createCaller({ userId });

  let data;
  try {
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  // Locate the song. If the songId doesn't belong to this project, we
  // 404 — the same response shape an unknown project gives, so a
  // tampered URL can't enumerate the song graph.
  const track = data.tracks.find((t) => t.id === songId);
  if (!track) {
    notFound();
  }

  // Parallel: sessions + contacts (for the LinkPill state).
  const [bookingsResult, clientsResult] = await Promise.allSettled([
    caller.booking.list(),
    caller.clientContacts.listWithProjects({ view: "by-client" }),
  ]);

  const allBookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : [];

  // Per-song bookings: same project AND same song. The song-link came
  // in via Phase 0 (bookings.song_id). When a booking isn't tagged to
  // a specific song (older rows) we still include it if the project
  // has exactly one track — the Single-Space rule means the project
  // IS the song.
  const isSingleProject = data.tracks.length === 1;
  const projectBookings = allBookings.filter((b) => b.projectId === data.project.id);
  const songBookings = projectBookings.filter(
    (b) => b.songId === songId || (isSingleProject && b.songId === null),
  );

  const sessions: SessionsTabSession[] = songBookings.map((b) => ({
    id: b.id,
    startsAt: b.startsAt,
    durationMinutes: b.durationMin,
    name: `Session with ${b.artistName}`,
    attendees: [b.artistName],
  }));

  // Versions for THIS song. data.versions is already newest-first.
  const songVersions = data.versions.filter((v) => v.trackId === track.id);

  // Comments per song (across this song's versions) — drives the noteCount
  // metric on individual version rows AND the hero meta line.
  const versionIds = new Set(songVersions.map((v) => v.id));
  const songComments = data.comments.filter((c) => versionIds.has(c.versionId));

  // ── Shape: version rows (newest-first) ──────────────────────────
  // track_versions has no author or changelog column in v1 — we
  // surface "You" as the uploader and an empty changelog string. Phase
  // 4 can extend the schema if real attribution is needed.
  const versions: VersionRowVersionData[] = songVersions.map((v) => {
    const noteCount = songComments.filter(
      (c) => c.versionId === v.id && c.resolvedAt === null,
    ).length;
    return {
      id: v.id,
      versionLabel: v.label,
      audioUrl: v.audioUrl,
      uploadedAtIso: v.uploadedAt.toISOString(),
      uploadedBy: "You",
      changelog: "",
      durationMs: v.durationMs,
      noteCount,
    };
  });

  // ── Shape: song meta ────────────────────────────────────────────
  const latestVersion = songVersions[0];
  const totalNoteCount = songComments.filter((c) => c.resolvedAt === null).length;
  const mode: "album" | "single" = isSingleProject ? "single" : "album";

  // Use the project deadline only; payment due dates are purchase-owned.
  const deadline = data.project.deadlineAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(data.project.deadlineAt)
    : "—";
  const isOverdue =
    data.project.deadlineAt !== null &&
    data.project.deadlineAt < new Date() &&
    data.project.lifecycleStatus !== "completed" &&
    data.project.lifecycleStatus !== "canceled";

  const songStage: WorkflowStage = track.workflowStage;
  // Tip the progress slightly higher when the song has more versions
  // — keeps the bar reactive while we wait for a real per-song
  // progress column (Phase 4).
  const baseProgress = progressForStage(songStage);
  const versionBoost = Math.min(10, songVersions.length > 0 ? songVersions.length * 2 : 0);
  const songProgress = Math.min(100, baseProgress + versionBoost);

  const song: SongSpaceSong = {
    id: track.id,
    purchaseId: track.purchaseId,
    title: track.title,
    currentVersion: latestVersion?.label ?? "v0",
    noteCount: totalNoteCount,
    durationMs: latestVersion?.durationMs ?? null,
    workflowStage: songStage,
    progress: songProgress,
    deadline,
    isOverdue,
    revisionCount: Math.max(0, songVersions.length - 1),
  };

  const project: SongSpaceProject = {
    id: data.project.id,
    name: data.project.title,
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
  const purchaseSummaries: ProjectPurchaseSummary[] = data.purchases.map((purchase) => ({
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
  }));

  // ── Client snippet ──────────────────────────────────────────────
  // The project carries the client identity snapshot (clientName +
  // clientEmail with legacy artistName/artistEmail fallback). LinkPill
  // state comes from clientContacts.listWithProjects view=by-client —
  // we match on the stable project client-contact id.
  const clientName = data.project.clientName ?? data.project.artistName;
  // artistEmail is NOT NULL at the column level — so the project
  // always has at least the legacy email. clientEmail is the modern
  // optional override.
  const clientEmail: string = data.project.clientEmail ?? data.project.artistEmail;

  let linkState: LinkPillState = "none";
  let clientContactId = "";
  if (clientsResult.status === "fulfilled" && clientsResult.value.view === "by-client") {
    const contact = clientsResult.value.clients.find((c) => c.id === data.project.clientContactId);
    if (contact) {
      clientContactId = contact.id;
      linkState = contact.clerkUserId ? "active" : contact.invitedAt ? "pending" : "none";
    }
  }

  const client: SongSpaceClient = {
    id: clientContactId,
    name: clientName,
    email: clientEmail,
    linkState,
  };

  // ── Hero gradient — project-name derived for parity with the
  // album hero. Sticking with project.name (not song.title) means the
  // Album hero and any of its Song Spaces share the same band color,
  // which keeps the room-of-a-room visual anchor stable.
  const gradientToken = deriveGradient(data.project.title);

  // Note: the SongSpaceHero's "Play latest" CTA is wired by the
  // <SongSpace> client component itself — it has access to the
  // playerPlay() helper and can dispatch when the user clicks. Server
  // components can't construct an onClick closure, so we just pass the
  // raw data through and let the shell decide whether to enable the
  // CTA based on versions[0].audioUrl presence.

  // Breadcrumb extras pushed to the sticky topbar (which always prepends
  // the "Clients & Projects" section root). Path reads:
  //   Clients & Projects › <client> › <project> › <song>   (album mode)
  //   Clients & Projects › <client> › <song>               (single mode)
  // The client crumb only links to the client page when we resolved a
  // matching client_contacts row. If the projection is unavailable,
  // keep the label visible without inventing a link.
  const clientCrumb = clientContactId
    ? {
        label: clientName,
        href: `/dashboard/clients-projects/clients/${clientContactId}`,
      }
    : { label: clientName };
  const breadcrumbExtras =
    mode === "album"
      ? [
          clientCrumb,
          {
            label: data.project.title,
            href: `/dashboard/clients-projects/${data.project.id}`,
          },
          { label: song.title },
        ]
      : [clientCrumb, { label: song.title }];

  return (
    <main className="sk-page-enter mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <SetTopBarBreadcrumb crumbs={breadcrumbExtras} />
      <SongSpace
        mode={mode}
        song={song}
        project={project}
        actionProject={actionProject}
        purchases={purchaseSummaries}
        client={client}
        versions={versions}
        sessions={sessions}
        gradientToken={gradientToken}
      />
    </main>
  );
}
