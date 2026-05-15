import {
  stageColor,
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { StatTile } from "~/components/dashboard/common/stat-tile";

// SongSpaceStatStrip — 4 StatTiles sit directly under the
// SongSpaceHero (DESIGN.md §4.4): Status pill · Progress + bar ·
// Deadline · Versions (current label + revision count).
//
// Mirrors AlbumStatStrip's shape, with two song-scoped variants:
//   - Status: this song's workflow stage (not the project's)
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
}

export function SongSpaceStatStrip({
  workflowStage,
  progress,
  deadline,
  isOverdue,
  currentVersion,
  revisionCount,
}: SongSpaceStatStripProps) {
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const stageHue = stageColor(workflowStage);
  const revisionSuffix = revisionCount === 1 ? "revision" : "revisions";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Status"
        value={
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest"
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
        }
      />
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
