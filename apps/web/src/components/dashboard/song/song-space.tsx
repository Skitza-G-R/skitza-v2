"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { playerPlay } from "~/components/audio/persistent-player";
import type { GradientToken } from "~/lib/clients/derive-gradient";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import type { LinkPillState } from "~/components/dashboard/clients/link-pill";

import { SongSpaceHero } from "./song-space-hero";
import { SongSpaceStatStrip } from "./song-space-stat-strip";
import { SongTabs, type SongTab } from "./song-tabs";
import { OverviewTab } from "./song-tabs/overview-tab";
import { VersionsTab } from "./song-tabs/versions-tab";
import { SessionsTab, type SessionsTabSession } from "./song-tabs/sessions-tab";
import { UploadTrackModal } from "./upload-track-modal";
import type { VersionRowVersionData } from "./version-row";
import {
  ProjectActionControls,
  type ProjectActionProject,
} from "~/components/dashboard/projects/project-action-controls";
import {
  ProjectPurchasesPanel,
  type ProjectPurchaseSummary,
} from "~/components/dashboard/projects/project-purchases-panel";
import { canCreatePurchaseOwnedProjectWork } from "~/components/dashboard/projects/project-upload-access";
import {
  PaymentHistoryView,
  type PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

// SongSpace — top-level shell for the new Song Space (and Single
// Space). Owns the active-tab state, composes SongSpaceHero +
// SongSpaceStatStrip + SongTabs + the active panel (DESIGN.md §4.4,
// BUILD-NOTES §5.4).
//
// The `mode` prop discriminates album vs single. It threads into:
//   - SongSpaceHero (eyebrow + meta line shape)
//   - SongTabs
//   - OverviewTab (hides Client snippet in single mode)

export interface SongSpaceSong {
  id: string;
  purchaseId: string;
  title: string;
  archivedAtIso: string | null;
  releasedAtIso?: string | null;
  currentVersion: string;
  noteCount: number;
  durationMs: number | null;
  workflowStage: WorkflowStage;
  progress: number;
  deadline: string;
  isOverdue: boolean;
  /** Total versions - 1. */
  revisionCount: number;
  publicExposure: "none" | "link" | "portfolio" | "link_and_portfolio";
}

export interface SongSpaceProject {
  id: string;
  name: string;
}

export interface SongSpaceClient {
  id: string;
  name: string;
  email: string | null;
  linkState: LinkPillState;
}

interface SongSpaceProps {
  mode: "album" | "single";
  song: SongSpaceSong;
  project: SongSpaceProject;
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  paymentHistory?: PaymentHistoryViewData;
  client: SongSpaceClient;
  versions: VersionRowVersionData[];
  sessions: SessionsTabSession[];
  gradientToken: GradientToken;
  initialUploadOpen?: boolean;
  addAnotherSongHref?: string;
}

export function SongSpace({
  mode,
  song,
  project,
  actionProject,
  purchases,
  paymentHistory,
  client,
  versions,
  sessions,
  gradientToken,
  initialUploadOpen = false,
  addAnotherSongHref,
}: SongSpaceProps) {
  const router = useRouter();
  const [active, setActive] = useState<SongTab>("overview");
  const projectActive = actionProject.lifecycleStatus === "active";
  const songArchived = song.archivedAtIso !== null;
  const songReleased = song.releasedAtIso != null;
  const canUpload =
    !songArchived &&
    canCreatePurchaseOwnedProjectWork({
      projectLifecycleStatus: actionProject.lifecycleStatus,
      purchaseId: song.purchaseId,
      purchases,
    });
  const projectArchived =
    actionProject.lifecycleStatus === "completed" || actionProject.lifecycleStatus === "canceled";
  const newWorkBlockedReason = songArchived
    ? "Restore this song before uploading a new version."
    : projectArchived
      ? "New work is closed because this project is archived."
      : projectActive
        ? "New work requires an active purchase or accepted offer."
        : "New work requires an active project.";
  const lifecycleLabel = songArchived
    ? "Archived song"
    : projectArchived
      ? `Archived · ${actionProject.lifecycleStatus === "completed" ? "Completed" : "Canceled"}`
      : actionProject.lifecycleStatus === "waiting_for_payment"
        ? "Waiting for payment"
        : actionProject.lifecycleStatus === "paused"
          ? "Paused project"
          : "Active project";
  const releaseNotice = songReleased
    ? " Released is permanent; stored audio can now be permanently deleted after a warning."
    : "";
  // Phase 4: the Upload Track modal lives at the SongSpace level so both
  // the SongSpaceHero CTA and the VersionsTab drop zone open the same
  // instance. mode="new-version" + a locked trackId means the modal's
  // song picker renders as plain text (no "+ New song" option).
  const [uploadOpen, setUploadOpen] = useState(initialUploadOpen && canUpload);
  const openUpload = useCallback(() => {
    setUploadOpen(true);
  }, []);
  const closeUpload = useCallback(() => {
    setUploadOpen(false);
  }, []);

  // Latest playable version — used by SongSpaceHero's Play-latest CTA.
  // Versions are newest-first; explicit audio tombstones stay in history
  // but must never become player targets.
  const latest = versions.find(
    (version) => version.audioDeletedAtIso == null && version.audioUrl !== null,
  );
  const hasPlayable = latest !== undefined;

  // Hero's Play-latest CTA wires to playerPlay() with the freshest
  // version that has audio. Defined locally so server components can
  // pass plain JSON props and the client shell owns the side-effect.
  const handlePlayLatest = useCallback(() => {
    if (!latest || latest.audioDeletedAtIso != null || latest.audioUrl === null) return;
    playerPlay({
      id: latest.id,
      audioUrl: latest.audioUrl,
      title: song.title,
      subtitle: `${project.name} · ${latest.versionLabel}`,
      durationMs: latest.durationMs,
      cachePolicy: "account-unlocked",
    });
  }, [latest, song.title, project.name]);

  // Default label for the modal — auto-bumps to V{revisionCount+1}. The
  // modal can also derive this from tracks[].versionCount, but we lock
  // the SongSpace context to a single song, so passing it explicitly
  // skips the dropdown-driven re-derivation.
  const defaultLabel = `V${String(song.revisionCount + 1)}`;

  return (
    <div className="space-y-4 md:space-y-5">
      <SongSpaceHero
        mode={mode}
        song={song}
        project={project}
        client={client}
        gradientToken={gradientToken}
        uploadDisabledReason={newWorkBlockedReason}
        {...(hasPlayable ? { onPlayLatest: handlePlayLatest } : {})}
        {...(canUpload ? { onUploadNewVersion: openUpload } : {})}
      />

      <section
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4"
        aria-label="Song and project lifecycle"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10.5px] font-bold tracking-[0.11em] text-[rgb(var(--fg-muted))] uppercase">
              {lifecycleLabel}
            </p>
            {songReleased ? (
              <span
                role="status"
                className="inline-flex min-h-6 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.24)] bg-[rgb(var(--fg-success)/0.08)] px-2 text-[10.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-success))] uppercase"
              >
                Released
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
            {`${
              songArchived || projectArchived
                ? "Listening, payments, comments, history, and public links remain available. New uploads and comments are closed."
                : projectActive && canUpload
                  ? "Edit project details or archive the work when it is finished."
                  : projectActive
                    ? `Comments are open. ${newWorkBlockedReason}`
                    : "Uploads remain closed until this project returns to active work."
            }${releaseNotice}`}
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

      {mode === "single" && projectActive && addAnotherSongHref ? (
        <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
              Turn this single into an album
            </p>
            <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
              Use a purchased song space, or start a separate extra-song purchase.
            </p>
          </div>
          <Link
            href={addAnotherSongHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[12.5px] font-semibold text-[rgb(var(--bg-sidebar))]"
          >
            <Plus size={14} aria-hidden />
            Add another song
          </Link>
        </section>
      ) : null}

      {/* I5 — ChangeStageMenu now lives INSIDE the Status tile of the
          stat strip (via the trackId prop). Pre-fix this section was a
          standalone "Change stage" row that duplicated the Status tile's
          read-only pill, creating visual noise + a confusing dual-source
          of truth. */}
      <SongSpaceStatStrip
        workflowStage={song.workflowStage}
        progress={song.progress}
        deadline={song.deadline}
        isOverdue={song.isOverdue}
        currentVersion={song.currentVersion}
        revisionCount={song.revisionCount}
        {...(projectActive ? { trackId: song.id } : {})}
      />

      <SongTabs active={active} onChange={setActive} versionsCount={versions.length} />

      {active === "overview" ? (
        <OverviewTab
          song={{ workflowStage: song.workflowStage, title: song.title }}
          project={{ name: project.name }}
          latestVersions={versions}
          client={client}
          mode={mode}
          emptyVersionsMessage={
            canUpload
              ? "No versions yet — upload the first one to get started."
              : newWorkBlockedReason
          }
          onShowAllVersions={() => {
            setActive("versions");
          }}
        />
      ) : null}
      {active === "versions" ? (
        <VersionsTab
          song={{ title: song.title }}
          project={{ name: project.name }}
          versions={versions}
          blockedReason={newWorkBlockedReason}
          {...(canUpload ? { onAddVersion: openUpload } : {})}
        />
      ) : null}
      {active === "sessions" ? <SessionsTab sessions={sessions} /> : null}
      {paymentHistory ? <PaymentHistoryView role="producer" data={paymentHistory} /> : null}
      <ProjectPurchasesPanel projectId={project.id} purchases={purchases} />
      {/* Phase 4: shared Upload Track modal — fired from SongSpaceHero's
          "Upload new version" CTA AND from the VersionsTab drop zone.
          The song picker is locked (mode="new-version" + trackId), so
          the producer can't accidentally upload into a different track. */}
      {canUpload ? (
        <UploadTrackModal
          open={uploadOpen}
          onClose={closeUpload}
          projectId={project.id}
          mode="new-version"
          trackId={song.id}
          defaultLabel={defaultLabel}
          tracks={[
            {
              id: song.id,
              title: song.title,
              versionCount: versions.length,
              publicExposure: song.publicExposure,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
