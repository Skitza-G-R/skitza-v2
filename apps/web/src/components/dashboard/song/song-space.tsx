"use client";

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
import {
  SessionsTab,
  type SessionsTabSession,
} from "./song-tabs/sessions-tab";
import {
  PaymentsTab,
  type PaymentMilestone,
} from "./song-tabs/payments-tab";
import { UploadTrackModal } from "./upload-track-modal";
import type { VersionRowVersionData } from "./version-row";

// SongSpace — top-level shell for the new Song Space (and Single
// Space). Owns the active-tab state, composes SongSpaceHero +
// SongSpaceStatStrip + SongTabs + the active panel (DESIGN.md §4.4,
// BUILD-NOTES §5.4).
//
// The `mode` prop discriminates album vs single. It threads into:
//   - SongSpaceHero (eyebrow + meta line shape)
//   - SongTabs (3 vs 4 tabs)
//   - OverviewTab (hides Client snippet in single mode)
//   - PaymentsTab (only rendered in single mode)

export interface SongSpaceSong {
  id: string;
  title: string;
  currentVersion: string;
  noteCount: number;
  durationMs: number | null;
  workflowStage: WorkflowStage;
  progress: number;
  deadline: string;
  isOverdue: boolean;
  /** Total versions - 1. */
  revisionCount: number;
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

export interface SongSpacePayments {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
  milestones: PaymentMilestone[];
}

interface SongSpaceProps {
  mode: "album" | "single";
  song: SongSpaceSong;
  project: SongSpaceProject;
  client: SongSpaceClient;
  versions: VersionRowVersionData[];
  sessions: SessionsTabSession[];
  gradientToken: GradientToken;
  /** Only required when mode === "single". */
  payments?: SongSpacePayments;
}

export function SongSpace({
  mode,
  song,
  project,
  client,
  versions,
  sessions,
  gradientToken,
  payments,
}: SongSpaceProps) {
  const [active, setActive] = useState<SongTab>("overview");
  // Phase 4: the Upload Track modal lives at the SongSpace level so both
  // the SongSpaceHero CTA and the VersionsTab drop zone open the same
  // instance. mode="new-version" + a locked trackId means the modal's
  // song picker renders as plain text (no "+ New song" option).
  const [uploadOpen, setUploadOpen] = useState(false);
  const openUpload = useCallback(() => {
    setUploadOpen(true);
  }, []);
  const closeUpload = useCallback(() => {
    setUploadOpen(false);
  }, []);

  // Latest playable version — used by SongSpaceHero's Play-latest CTA.
  // We treat versions as newest-first (parent ordering).
  const latest = versions[0];
  const hasPlayable = latest !== undefined && latest.audioUrl !== null;

  // Hero's Play-latest CTA wires to playerPlay() with the freshest
  // version that has audio. Defined locally so server components can
  // pass plain JSON props and the client shell owns the side-effect.
  const handlePlayLatest = useCallback(() => {
    if (!latest || latest.audioUrl === null) return;
    playerPlay({
      id: latest.id,
      audioUrl: latest.audioUrl,
      title: song.title,
      subtitle: `${project.name} · ${latest.versionLabel}`,
      durationMs: latest.durationMs,
    });
  }, [latest, song.title, project.name]);

  // Default label for the modal — auto-bumps to v{revisionCount+1}. The
  // modal can also derive this from tracks[].versionCount, but we lock
  // the SongSpace context to a single song, so passing it explicitly
  // skips the dropdown-driven re-derivation.
  const defaultLabel = `v${String(song.revisionCount + 1)}`;

  return (
    <div className="space-y-6">
      <SongSpaceHero
        mode={mode}
        song={song}
        project={project}
        client={client}
        gradientToken={gradientToken}
        {...(hasPlayable ? { onPlayLatest: handlePlayLatest } : {})}
        onUploadNewVersion={openUpload}
      />

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
        trackId={song.id}
      />

      <SongTabs
        mode={mode}
        active={active}
        onChange={setActive}
        versionsCount={versions.length}
      />

      {active === "overview" ? (
        <OverviewTab
          song={{ workflowStage: song.workflowStage, title: song.title }}
          project={{ name: project.name }}
          latestVersions={versions}
          client={client}
          mode={mode}
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
          onAddVersion={openUpload}
        />
      ) : null}
      {active === "sessions" ? <SessionsTab sessions={sessions} /> : null}
      {active === "payments" && mode === "single" && payments ? (
        <PaymentsTab
          paidCents={payments.paidCents}
          outstandingCents={payments.outstandingCents}
          currency={payments.currency}
          nextChargeAt={payments.nextChargeAt}
          milestones={payments.milestones}
        />
      ) : null}

      {/* Phase 4: shared Upload Track modal — fired from SongSpaceHero's
          "Upload new version" CTA AND from the VersionsTab drop zone.
          The song picker is locked (mode="new-version" + trackId), so
          the producer can't accidentally upload into a different track. */}
      <UploadTrackModal
        open={uploadOpen}
        onClose={closeUpload}
        projectId={project.id}
        mode="new-version"
        trackId={song.id}
        defaultLabel={defaultLabel}
        tracks={[{ id: song.id, title: song.title, versionCount: versions.length }]}
      />
    </div>
  );
}
