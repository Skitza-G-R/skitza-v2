import {
  stageColor,
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { StatTile } from "~/components/dashboard/common/stat-tile";

// AlbumStatStrip — 4 StatTiles sit directly under the AlbumHero
// (DESIGN.md §4.3): Status pill · Progress + bar · Deadline · Outstanding.
//
// Visual variants:
//   - Status:       always default — the colored stage pill is the
//                   "value" itself.
//   - Progress:     default — the StatTile `sub` renders a small amber
//                   progress bar below the percentage.
//   - Deadline:     `danger` when isOverdue, else default.
//   - Outstanding:  `danger` when outstandingCents > 0; `ok` when 0
//                   (paid).

interface AlbumStatStripProps {
  workflowStage: WorkflowStage;
  /** 0..100 — overall project progress. */
  progress: number;
  /** Formatted deadline string ("3d", "May 28", "—" if no deadline). */
  deadline: string;
  isOverdue: boolean;
  outstandingCents: number;
  currency: string;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function AlbumStatStrip({
  workflowStage,
  progress,
  deadline,
  isOverdue,
  outstandingCents,
  currency,
}: AlbumStatStripProps) {
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const stageHue = stageColor(workflowStage);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Status"
        value={
          <span
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest"
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
        value={
          <span className="tabular-nums">{clampedProgress}%</span>
        }
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
      {outstandingCents > 0 ? (
        <StatTile
          label="Outstanding"
          value={formatMoney(outstandingCents, currency)}
          variant="danger"
        />
      ) : (
        <StatTile label="Outstanding" value="Paid" variant="ok" />
      )}
    </div>
  );
}
