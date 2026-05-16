import {
  stageColor,
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { StatTile } from "~/components/dashboard/common/stat-tile";

import { ChangeStageMenu } from "./change-stage-menu";

// SongSpaceStatStrip — 4 StatTiles sit directly under the
// SongSpaceHero (DESIGN.md §4.4): Status pill · Progress + bar ·
// Deadline · Versions (current label + revision count).
//
// Mirrors AlbumStatStrip's shape, with two song-scoped variants:
//   - Status: this song's workflow stage (not the project's). When a
//     trackId is provided the Status tile renders ChangeStageMenu so
//     the producer can advance stage in-place (I5). Without a trackId
//     it falls back to a read-only pill.
//   - Versions: replaces the album's Outstanding tile with the
//     current version label + "+ N revisions" sub-line

interface SongSpaceStatStripProps {
  workflowStage: WorkflowStage;
  /** 0..100 — this song's progress. */
  progress: number;
  /** Formatted deadline string ("3d", "May 28", "—"). */
  deadline: string;
  isOverdue: boolean;
  /** Latest version label (e.g. "v3"). */
  currentVersion: string;
  /** Total versions - 1 (counts how many revisions came before). */
  revisionCount: number;
  /**
   * Track id for the Status tile's interactive stage picker (I5).
   * When omitted the tile renders a read-only stage pill. Single-mode
   * callers always provide this; album-mode passes the song's id when
   * the strip is for a song row.
   */
  trackId?: string;
}

export function SongSpaceStatStrip({
  workflowStage,
  progress,
  deadline,
  isOverdue,
  currentVersion,
  revisionCount,
  trackId,
}: SongSpaceStatStripProps) {
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const stageHue = stageColor(workflowStage);
  const revisionSuffix = revisionCount === 1 ? "revision" : "revisions";

  // I5 — the Status tile now hosts ChangeStageMenu when a trackId is
  // present, so producers advance the stage in-place instead of via a
  // duplicate "Change stage" row above the strip. Falls back to a
  // read-only pill when no trackId is wired (defensive).
  const statusContent = trackId ? (
    <ChangeStageMenu trackId={trackId} current={workflowStage} />
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest"
      style={{
        color: stageHue,
        borderColor: stageHue,
        background: "transparent",
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: stageHue }}
      />
      {stageLabel(workflowStage)}
    </span>
  );

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Status" value={statusContent} />
      <StatTile
        label="Progress"
        value={<span className="tabular-nums">{clampedProgress}%</span>}
        sub={
          <span
            className="block h-1 w-full overflow-hidden rounded-full"
            style={{ background: "rgb(var(--border-subtle))" }}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${String(clampedProgress)}%`,
                background: "rgb(var(--brand-primary))",
              }}
            />
          </span>
        }
      />
      {isOverdue ? (
        <StatTile label="Deadline" value={deadline} variant="danger" />
      ) : (
        <StatTile label="Deadline" value={deadline} />
      )}
      <StatTile
        label="Versions"
        value={
          <span className="font-mono tabular-nums">{currentVersion}</span>
        }
        sub={`+ ${String(revisionCount)} ${revisionSuffix}`}
      />
    </div>
  );
}
