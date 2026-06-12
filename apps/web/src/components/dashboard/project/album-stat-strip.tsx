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
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--border-subtle))] md:grid-cols-4 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent">
      <StatTile mobileCompact
        label="Status"
        value={
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
        }
      />
      <StatTile mobileCompact
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
        <StatTile mobileCompact label="Deadline" value={deadline} variant="danger" />
      ) : (
        <StatTile mobileCompact label="Deadline" value={deadline} />
      )}
      {outstandingCents > 0 ? (
        <StatTile mobileCompact
          label="Outstanding"
          value={formatMoney(outstandingCents, currency)}
          variant="danger"
        />
      ) : (
        <StatTile mobileCompact label="Outstanding" value="Paid" variant="ok" />
      )}
    </div>
  );
}
