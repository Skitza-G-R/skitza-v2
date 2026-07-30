"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { canCreatePurchaseOwnedProjectWork } from "~/components/dashboard/projects/project-upload-access";
import { SongSpaceStatStrip } from "~/components/dashboard/song/song-space-stat-strip";
import { SongTabs, type SongTab } from "~/components/dashboard/song/song-tabs";
import { OverviewTab } from "~/components/dashboard/song/song-tabs/overview-tab";
import {
  SessionsTab,
  type SessionsTabSession,
} from "~/components/dashboard/song/song-tabs/sessions-tab";
import { VersionsTab } from "~/components/dashboard/song/song-tabs/versions-tab";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";
import type { VersionRowVersionData } from "~/components/dashboard/song/version-row";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";

export interface ProjectSongWorkspaceSong {
  id: string;
  purchaseId: string;
  title: string;
  archivedAtIso: string | null;
  currentVersion: string;
  workflowStage: WorkflowStage;
  progress: number;
  deadline: string;
  isOverdue: boolean;
  revisionCount: number;
  publicExposure: "none" | "link" | "portfolio" | "link_and_portfolio";
}

export interface ProjectSongWorkspaceData {
  song: ProjectSongWorkspaceSong;
  versions: VersionRowVersionData[];
  sessions: SessionsTabSession[];
}

interface ProjectSongWorkspaceProps {
  project: {
    id: string;
    name: string;
  };
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  data: ProjectSongWorkspaceData;
  initialUploadOpen?: boolean;
}

export function ProjectSongWorkspace({
  project,
  actionProject,
  purchases,
  data,
  initialUploadOpen = false,
}: ProjectSongWorkspaceProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState<SongTab>("overview");
  const canUpload =
    data.song.archivedAtIso === null &&
    canCreatePurchaseOwnedProjectWork({
      projectLifecycleStatus: actionProject.lifecycleStatus,
      purchaseId: data.song.purchaseId,
      purchases,
    });
  const projectArchived =
    actionProject.lifecycleStatus === "completed" || actionProject.lifecycleStatus === "canceled";
  const blockedReason =
    data.song.archivedAtIso !== null
      ? "Restore this song before uploading a new version."
      : projectArchived
        ? "New work is closed because this project is archived."
        : actionProject.lifecycleStatus === "active"
          ? "New work requires an active purchase or accepted offer."
          : "New work requires an active project.";
  const [uploadOpen, setUploadOpen] = useState(initialUploadOpen && canUpload);

  useEffect(() => {
    if (!initialUploadOpen || searchParams.get("upload") !== "1") return;

    if (canUpload) setUploadOpen(true);
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("upload");
    const nextQuery = nextSearchParams.toString();
    const canonicalHref = `${nextQuery ? `${pathname}?${nextQuery}` : pathname}${
      window.location.hash
    }`;
    window.history.replaceState(null, "", canonicalHref);
  }, [canUpload, initialUploadOpen, pathname, searchParams]);

  return (
    <section
      data-tab-swipe-ignore
      aria-labelledby={`song-workspace-${data.song.id}`}
      className="mt-5 space-y-4 border-t border-[rgb(var(--border-subtle))] pt-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase">
            Song workspace
          </p>
          <h3
            id={`song-workspace-${data.song.id}`}
            className="font-syne mt-1 truncate text-[20px] font-bold text-[rgb(var(--fg-default))]"
          >
            {data.song.title}
          </h3>
          <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
            {data.song.currentVersion} · {String(data.versions.length)}{" "}
            {data.versions.length === 1 ? "version" : "versions"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setUploadOpen(true);
          }}
          disabled={!canUpload}
          title={canUpload ? "Upload new version" : blockedReason}
          className="sk-press inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12.5px] font-semibold text-[rgb(var(--bg-background))] shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          <Upload size={14} strokeWidth={2.2} aria-hidden />
          Upload new version
        </button>
      </div>

      <SongSpaceStatStrip
        workflowStage={data.song.workflowStage}
        progress={data.song.progress}
        deadline={data.song.deadline}
        isOverdue={data.song.isOverdue}
        currentVersion={data.song.currentVersion}
        revisionCount={data.song.revisionCount}
        {...(actionProject.lifecycleStatus === "active" ? { trackId: data.song.id } : {})}
      />

      <SongTabs active={active} onChange={setActive} versionsCount={data.versions.length} />

      {active === "overview" ? (
        <OverviewTab
          song={{
            workflowStage: data.song.workflowStage,
            title: data.song.title,
          }}
          project={{ name: project.name }}
          latestVersions={data.versions}
          mode="album"
          showClient={false}
          emptyVersionsMessage={
            canUpload ? "No versions yet — upload the first one to get started." : blockedReason
          }
          onShowAllVersions={() => {
            setActive("versions");
          }}
        />
      ) : null}
      {active === "versions" ? (
        <VersionsTab
          song={{ title: data.song.title }}
          project={{ name: project.name }}
          versions={data.versions}
          blockedReason={blockedReason}
          {...(canUpload
            ? {
                onAddVersion: () => {
                  setUploadOpen(true);
                },
              }
            : {})}
        />
      ) : null}
      {active === "sessions" ? <SessionsTab sessions={data.sessions} /> : null}

      {canUpload ? (
        <UploadTrackModal
          open={uploadOpen}
          onClose={() => {
            setUploadOpen(false);
          }}
          projectId={project.id}
          mode="new-version"
          trackId={data.song.id}
          tracks={[
            {
              id: data.song.id,
              title: data.song.title,
              versionCount: data.versions.length,
              publicExposure: data.song.publicExposure,
            },
          ]}
        />
      ) : null}
    </section>
  );
}
