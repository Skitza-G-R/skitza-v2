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

interface AlbumSpaceProps {
  project: AlbumSpaceProject;
  tracks: TrackRowData[];
  payments: AlbumSpacePayments;
  studioLog: AlbumSpaceStudioLog;
}

export function AlbumSpace({
  project,
  tracks,
  payments,
  studioLog,
}: AlbumSpaceProps) {
  const [active, setActive] = useState<AlbumTab>("songs");

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

  return (
    <div className="space-y-6">
      <AlbumHero project={heroProject} />

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
        <SongsTab projectId={project.id} tracks={tracks} />
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
    </div>
  );
}
