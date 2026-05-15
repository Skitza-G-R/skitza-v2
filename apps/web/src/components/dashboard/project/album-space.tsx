"use client";

import { useState } from "react";

import {
  AlbumHero,
  type AlbumHeroProject,
} from "./album-hero";
import { AlbumStatStrip } from "./album-stat-strip";
import { AlbumTabs, type AlbumTab } from "./album-tabs";
import { SongsTab } from "./album-tabs/songs-tab";
import { FilesTab } from "./album-tabs/files-tab";
import {
  PaymentsTab,
  type PaymentMilestone,
} from "./album-tabs/payments-tab";
import {
  StudioLogTab,
  type StudioLogActivity,
  type StudioLogSession,
} from "./album-tabs/studio-log-tab";
import type { TrackRowData } from "./track-row";
import { playerPlay } from "~/components/audio/persistent-player";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";

// AlbumSpace — the top-level shell for the new Album Page. Owns the
// active-tab state and composes AlbumHero + AlbumStatStrip + AlbumTabs
// + the active panel content (DESIGN.md §4.3, BUILD-NOTES §5.3).

export interface AlbumSpaceProjectExtras {
  progress: number;
  deadline: string;
  isOverdue: boolean;
  outstandingCents: number;
}

export type AlbumSpaceProject = AlbumHeroProject & AlbumSpaceProjectExtras;

export interface AlbumSpacePayments {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
  milestones: PaymentMilestone[];
}

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
// null when the album has no playable audio yet — hero shows the CTA
// in its disabled "Coming soon" form.
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
  tracks: TrackRowData[];
  payments: AlbumSpacePayments;
  studioLog: AlbumSpaceStudioLog;
  /** Newest playable version. When null, hero "Play latest" stays disabled. */
  playLatest?: AlbumSpacePlayLatest | null;
}

export function AlbumSpace({
  project,
  tracks,
  payments,
  studioLog,
  playLatest = null,
}: AlbumSpaceProps) {
  const [active, setActive] = useState<AlbumTab>("songs");
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
    <div className="space-y-6">
      <AlbumHero
        project={heroProject}
        {...(handlePlayLatest ? { onPlayLatest: handlePlayLatest } : {})}
        onAddSong={handleAddSong}
      />

      <AlbumStatStrip
        workflowStage={project.workflowStage}
        progress={project.progress}
        deadline={project.deadline}
        isOverdue={project.isOverdue}
        outstandingCents={project.outstandingCents}
        currency={project.currency}
      />

      <AlbumTabs
        active={active}
        onChange={setActive}
        songsCount={project.songsCount}
      />

      {active === "songs" ? (
        <SongsTab
          projectId={project.id}
          tracks={tracks}
          onAddSong={handleAddSong}
        />
      ) : null}
      {active === "files" ? <FilesTab projectId={project.id} /> : null}
      {active === "payments" ? (
        <PaymentsTab
          paidCents={payments.paidCents}
          outstandingCents={payments.outstandingCents}
          currency={payments.currency}
          nextChargeAt={payments.nextChargeAt}
          milestones={payments.milestones}
        />
      ) : null}
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

      <UploadTrackModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
        }}
        projectId={project.id}
        mode="new-song"
        tracks={modalTracks}
      />
    </div>
  );
}
