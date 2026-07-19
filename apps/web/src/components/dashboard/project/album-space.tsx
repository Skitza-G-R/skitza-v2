"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AlbumHero, type AlbumHeroProject } from "./album-hero";
import { AlbumStatStrip } from "./album-stat-strip";
import { AlbumTabs, type AlbumTab } from "./album-tabs";
import {
  SongsTab,
  type EmptySongSpaceRowData,
} from "./album-tabs/songs-tab";
import { FilesTab } from "./album-tabs/files-tab";
import {
  StudioLogTab,
  type StudioLogActivity,
  type StudioLogSession,
} from "./album-tabs/studio-log-tab";
import type { TrackRowData } from "./track-row";
import { playerPlay } from "~/components/audio/persistent-player";
import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";
import {
  ProjectPurchasesPanel,
  type ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";

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
  mode?: "single" | "album";
  project: AlbumSpaceProject;
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  tracks: TrackRowData[];
  emptySlots?: readonly EmptySongSpaceRowData[];
  addSongHref: string;
  studioLog: AlbumSpaceStudioLog;
  /** Newest playable version. When null, hero "Play latest" stays disabled. */
  playLatest?: AlbumSpacePlayLatest | null;
}

export function AlbumSpace({
  mode = "album",
  project,
  actionProject,
  purchases,
  tracks,
  emptySlots = [],
  addSongHref,
  studioLog,
  playLatest = null,
}: AlbumSpaceProps) {
  const router = useRouter();
  const [active, setActive] = useState<AlbumTab>("songs");
  const projectActive = actionProject.lifecycleStatus === "active";
  const canAddSong = projectActive;
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

  const handleAddSong = (slot?: EmptySongSpaceRowData) => {
    if (!slot) {
      router.push(addSongHref);
      return;
    }
    const separator = addSongHref.includes("?") ? "&" : "?";
    router.push(
      `${addSongHref}${separator}purchaseId=${encodeURIComponent(slot.purchaseId)}&lockProject=1`,
    );
  };

  return (
    <div className="space-y-4 md:space-y-5">
      <AlbumHero
        project={heroProject}
        mode={mode}
        uploadDisabledReason={newWorkBlockedReason}
        {...(handlePlayLatest ? { onPlayLatest: handlePlayLatest } : {})}
        {...(canAddSong ? { onAddSong: handleAddSong } : {})}
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
              : projectActive
                ? "Add songs from purchased spaces, or start a separate extra-song purchase."
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
          tracks={tracks}
          emptySlots={emptySlots}
          canAddSong={canAddSong}
          blockedReason={newWorkBlockedReason}
          {...(canAddSong ? { onAddSong: handleAddSong } : {})}
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
    </div>
  );
}
