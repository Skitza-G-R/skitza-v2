"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";
import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";

import { AlbumTabs, type AlbumTab } from "./album-tabs";
import { DetailsTab } from "./album-tabs/details-tab";
import { PaymentsTab, type ProjectPaymentsTabData } from "./album-tabs/project-payments-tab";
import { SongsTab } from "./album-tabs/songs-tab";
import { StudioLogTab, type StudioLogEntry } from "./album-tabs/studio-log-tab";
import { ProjectCompactHeader, type ProjectPaymentAttention } from "./project-compact-header";
import {
  ProjectSongUploadController,
  type ProjectSongUploadData,
} from "./project-song-upload-controller";
import type { TrackRowData } from "./track-row";

const ALBUM_TAB_ORDER: readonly AlbumTab[] = ["songs", "payments", "log", "details"];

export interface AlbumSpaceProject {
  id: string;
  name: string;
  clientName: string;
  songsCount: number;
  workflowStage: WorkflowStage;
  deadline: string;
  isOverdue: boolean;
  paymentAttention: ProjectPaymentAttention | null;
}

export interface AlbumSpaceStudioLog {
  entries: readonly StudioLogEntry[];
}

interface AlbumSpaceProps {
  project: AlbumSpaceProject;
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  payments: ProjectPaymentsTabData;
  tracks: TrackRowData[];
  selectedSongUpload?: ProjectSongUploadData | null;
  initialUploadOpen?: boolean;
  studioLog: AlbumSpaceStudioLog;
}

export function AlbumSpace({
  project,
  actionProject,
  purchases,
  payments,
  tracks,
  selectedSongUpload = null,
  initialUploadOpen = false,
  studioLog,
}: AlbumSpaceProps) {
  const router = useRouter();
  const [active, setActive] = useState<AlbumTab>("songs");
  const [addSongOpen, setAddSongOpen] = useState(false);
  const tabSwipeHandlers = useTabSwipe({
    items: ALBUM_TAB_ORDER,
    value: active,
    onChange: setActive,
  });
  const projectActive = actionProject.lifecycleStatus === "active";
  const canAddSong = projectActive;
  const archived =
    actionProject.lifecycleStatus === "completed" || actionProject.lifecycleStatus === "canceled";
  const newWorkBlockedReason = archived
    ? "New work is closed because this project is archived."
    : projectActive
      ? "Add a Song while this Project is active."
      : "New work requires an active project.";

  return (
    <div className="space-y-2.5 md:space-y-3">
      <ProjectCompactHeader
        name={project.name}
        clientName={project.clientName}
        workflowStage={project.workflowStage}
        deadline={project.deadline}
        isOverdue={project.isOverdue}
        paymentAttention={project.paymentAttention}
        canAddSong={canAddSong}
        blockedReason={newWorkBlockedReason}
        onOpenPayments={() => {
          setActive("payments");
        }}
        onAddSong={() => {
          setAddSongOpen(true);
        }}
      />

      <div className="sticky top-0 z-30 bg-[rgb(var(--bg-background)/0.94)] py-1.5 backdrop-blur-xl lg:top-16">
        <AlbumTabs active={active} onChange={setActive} songsCount={project.songsCount} />
      </div>

      <div data-tab-swipe-surface className="[touch-action:pan-y_pinch-zoom]" {...tabSwipeHandlers}>
        <div data-tab-swipe-panel>
          {active === "songs" ? (
            <SongsTab
              tracks={tracks}
              canAddSong={canAddSong}
              blockedReason={newWorkBlockedReason}
            />
          ) : null}
          {active === "payments" ? (
            <PaymentsTab projectId={project.id} payments={payments} purchases={purchases} />
          ) : null}
          {active === "log" ? <StudioLogTab entries={studioLog.entries} /> : null}
          {active === "details" ? (
            <DetailsTab
              project={project}
              actionProject={actionProject}
              onDeleted={() => {
                router.push("/dashboard/clients-projects");
              }}
            />
          ) : null}
        </div>
      </div>

      {selectedSongUpload ? (
        <ProjectSongUploadController
          key={selectedSongUpload.id}
          projectId={project.id}
          actionProject={actionProject}
          purchases={purchases}
          song={selectedSongUpload}
          initialUploadOpen={initialUploadOpen}
        />
      ) : null}
      <UploadTrackModal
        open={addSongOpen}
        onClose={() => {
          setAddSongOpen(false);
        }}
        mode="new-song"
        projectId={project.id}
        tracks={[]}
        onCreated={() => {
          setAddSongOpen(false);
        }}
      />
    </div>
  );
}
