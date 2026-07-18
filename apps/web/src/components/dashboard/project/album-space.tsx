"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AlbumHero, type AlbumHeroProject } from "./album-hero";
import { AlbumStatStrip } from "./album-stat-strip";
import { AlbumTabs, type AlbumTab } from "./album-tabs";
import { SongsTab } from "./album-tabs/songs-tab";
import { FilesTab } from "./album-tabs/files-tab";
import {
  StudioLogTab,
  type StudioLogActivity,
  type StudioLogSession,
} from "./album-tabs/studio-log-tab";
import type { TrackRowData } from "./track-row";
import { playerPlay } from "~/components/audio/persistent-player";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";
import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";
import {
  ProjectPurchasesPanel,
  type ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";
import { canCreatePurchaseOwnedProjectWork } from "~/components/dashboard/projects/project-upload-access";

// AlbumSpace — the top-level shell for the new Album Page. Owns the
// active-tab state and composes AlbumHero + AlbumStatStrip + AlbumTabs
// + the active panel content (DESIGN.md §4.3, BUILD-NOTES §5.3).

export interface AlbumSpaceProjectExtras {
  progress: number;
  deadline: string;
  isOverdue: boolean;
  outstandingCents: number | null;
}

export type AlbumSpaceProject = AlbumHeroProject & AlbumSpaceProjectExtras;

export interface AlbumSpaceStudioLog {
  sessionsCount: number;
  studioHours: number;
  thisMonthCount: number;
  lastSessionDate: Date | null;
  activities: StudioLogActivity[];
  sessions: StudioLogSession[];
}

// Latest playable version across the project — drives the AlbumHero
// "Play latest" CTA (G1 polish). Page.tsx derives this from the
// project's versions list (newest-first, skipping null audioUrls).
// null when the album has no playable audio yet — the hero keeps the CTA
// disabled and explains that no playable audio exists.
export interface AlbumSpacePlayLatest {
  versionId: string;
  audioUrl: string;
  songTitle: string;
  versionLabel: string;
  projectName: string;
  durationMs?: number;
}

interface AlbumSpaceProps {
  project: AlbumSpaceProject;
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  songSpacePurchaseId: string | null;
  tracks: TrackRowData[];
  studioLog: AlbumSpaceStudioLog;
  /** Newest playable version. When null, hero "Play latest" stays disabled. */
  playLatest?: AlbumSpacePlayLatest | null;
}

export function AlbumSpace({
  project,
  actionProject,
  purchases,
  songSpacePurchaseId,
  tracks,
  studioLog,
  playLatest = null,
}: AlbumSpaceProps) {
  const router = useRouter();
  const [active, setActive] = useState<AlbumTab>("songs");
  const projectActive = actionProject.lifecycleStatus === "active";
  const canUpload = canCreatePurchaseOwnedProjectWork({
    projectLifecycleStatus: actionProject.lifecycleStatus,
    purchaseId: songSpacePurchaseId,
    purchases,
  });
  const archived =
    actionProject.lifecycleStatus === "completed" || actionProject.lifecycleStatus === "canceled";
  const newWorkBlockedReason = archived
    ? "New work is closed because this project is archived."
    : projectActive
      ? "New work requires an active purchase or accepted offer."
      : "New work requires an active project.";
  const lifecycleLabel = archived
    ? `Archived · ${actionProject.lifecycleStatus === "completed" ? "Completed" : "Canceled"}`
    : actionProject.lifecycleStatus === "waiting_for_payment"
      ? "Waiting for payment"
      : actionProject.lifecycleStatus === "paused"
        ? "Paused project"
        : "Active project";
  // Hero "+ Add song" opens the same UploadTrackModal that SongsTab's
  // own "+ Add song" button does. Owning the state here lets both
  // triggers share one modal mount so the producer can fire it from
  // either spot without duplicate dialogs.
  const [uploadOpen, setUploadOpen] = useState(false);

  const heroProject: AlbumHeroProject = {
    id: project.id,
    name: project.name,
    clientName: project.clientName,
    songsCount: project.songsCount,
    sessionsCount: project.sessionsCount,
    totalCents: project.totalCents,
    currency: project.currency,
    workflowStage: project.workflowStage,
  };

  const handlePlayLatest = playLatest
    ? () => {
        playerPlay({
          id: playLatest.versionId,
          audioUrl: playLatest.audioUrl,
          title: playLatest.songTitle,
          subtitle: `${playLatest.projectName} · ${playLatest.versionLabel}`,
          durationMs: playLatest.durationMs ?? null,
        });
      }
    : undefined;

  const handleAddSong = () => {
    setUploadOpen(true);
  };

  // versionCount projection for the modal's existing-song dropdown.
  // Mirrors SongsTab's local projection so the modal renders the same
  // options whichever trigger summoned it.
  const modalTracks = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    versionCount: t.versionCount ?? 0,
  }));

  return (
    <div className="space-y-4 md:space-y-5">
      <AlbumHero
        project={heroProject}
        uploadDisabledReason={newWorkBlockedReason}
        {...(handlePlayLatest ? { onPlayLatest: handlePlayLatest } : {})}
        {...(canUpload ? { onAddSong: handleAddSong } : {})}
      />

      <section
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4"
        aria-label="Project lifecycle"
      >
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase">
            {lifecycleLabel}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
            {archived
              ? "Music, listening, payments, comments, history, and public links remain available."
              : projectActive && canUpload
                ? "Edit project details or archive the work when it is finished."
                : projectActive
                  ? `Comments are open. ${newWorkBlockedReason}`
                  : "Uploads remain closed until this project returns to active work."}
          </p>
        </div>
        <ProjectActionControls
          project={actionProject}
          className="sm:justify-end"
          onDeleted={() => {
            router.push("/dashboard/clients-projects");
          }}
        />
      </section>

      <AlbumStatStrip
        workflowStage={project.workflowStage}
        progress={project.progress}
        deadline={project.deadline}
        isOverdue={project.isOverdue}
        outstandingCents={project.outstandingCents}
        currency={project.currency}
      />

      <AlbumTabs active={active} onChange={setActive} songsCount={project.songsCount} />

      {active === "songs" ? (
        <SongsTab
          projectId={project.id}
          purchaseId={songSpacePurchaseId}
          tracks={tracks}
          canAddSong={canUpload}
          blockedReason={newWorkBlockedReason}
          {...(canUpload ? { onAddSong: handleAddSong } : {})}
        />
      ) : null}
      {active === "files" ? <FilesTab projectId={project.id} /> : null}
      {active === "log" ? (
        <StudioLogTab
          sessionsCount={studioLog.sessionsCount}
          studioHours={studioLog.studioHours}
          thisMonthCount={studioLog.thisMonthCount}
          lastSessionDate={studioLog.lastSessionDate}
          activities={studioLog.activities}
          sessions={studioLog.sessions}
        />
      ) : null}

      <ProjectPurchasesPanel projectId={project.id} purchases={purchases} />

      {canUpload ? (
        <UploadTrackModal
          open={uploadOpen}
          onClose={() => {
            setUploadOpen(false);
          }}
          projectId={project.id}
          purchaseId={songSpacePurchaseId}
          mode="new-song"
          tracks={modalTracks}
        />
      ) : null}
    </div>
  );
}
