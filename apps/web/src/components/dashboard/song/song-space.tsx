"use client";

import { useState } from "react";

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
  /** Phase 3 — calls playerPlay with the latest version. */
  onPlayLatest?: () => void;
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
  onPlayLatest,
}: SongSpaceProps) {
  const [active, setActive] = useState<SongTab>("overview");

  // Latest playable version — used by SongSpaceHero's Play-latest CTA.
  // We treat versions as newest-first (parent ordering).
  const latestVersionId = versions[0]?.id ?? null;
  const hasPlayable =
    latestVersionId !== null && versions[0]?.audioUrl !== null;

  return (
    <div className="space-y-6">
      <SongSpaceHero
        mode={mode}
        song={song}
        project={project}
        client={client}
        gradientToken={gradientToken}
        {...(hasPlayable && onPlayLatest ? { onPlayLatest } : {})}
      />

      <SongSpaceStatStrip
        workflowStage={song.workflowStage}
        progress={song.progress}
        deadline={song.deadline}
        isOverdue={song.isOverdue}
        currentVersion={song.currentVersion}
        revisionCount={song.revisionCount}
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
    </div>
  );
}
