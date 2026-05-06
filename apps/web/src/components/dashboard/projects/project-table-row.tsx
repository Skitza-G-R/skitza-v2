"use client";

// One row in the new HTML-style projects table.
// Replaces the prior plain `ProjectRowItem` (in projects-list.tsx) —
// adds gradient badge, progress bar, balance column, deadline column,
// and a chevron-right affordance. Selection checkbox stays on the left
// so bulk-select still works.

import Link from "next/link";

import { gradientCss, gradientFor } from "~/lib/project-gradient";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";
import { stageToState, STATE_TONE, type ProjectState } from "~/lib/projects/states";

// Heuristic mapping from stage → progress percentage. The HTML mockup
// shows real progress bars; we don't track sub-stage completion in
// the data model, so we project the funnel position to a percentage.
// Producers get a visual scan-rhythm without over-promising precision.
const STAGE_PROGRESS: Record<Stage, number> = {
  lead: 8,
  booked: 22,
  contract_sent: 38,
  in_production: 58,
  final_review: 78,
  paid: 100,
  archived: 100,
  payment_paused: 50,
  cancelled: 0,
};

export type ProjectTableRowData = {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  // Cents for outstanding (unpaid) money. 0 means settled.
  outstandingCents: number;
  // ISO string of next session start, or null when no session is booked.
  nextSessionAtIso: string | null;
  // ISO string of last meaningful activity (track upload, comment,
  // status change). Used for the "Last activity" tagline.
  lastActivityIso: string;
  currency: string;
  unresolvedComments: number;
};

export function ProjectTableRow({
  row,
  index,
  selected,
  onToggle,
  stateLabelOverride,
}: {
  row: ProjectTableRowData;
  index: number;
  selected: boolean;
  onToggle: () => void;
  // Caller may pass the translated state label (live/done/archived).
  // Optional — we fall back to the English STATE_LABEL constant.
  stateLabelOverride?: string;
}) {
  const state = stageToState(row.stage);
  const tone = STATE_TONE[state];
  const stateLabel = stateLabelOverride ?? DEFAULT_STATE_LABELS[state];
  const progress = STAGE_PROGRESS[row.stage];
  const grad = gradientFor(row.id);
  const owed = row.outstandingCents;
  const deadline = formatDeadline(row.nextSessionAtIso, row.lastActivityIso);

  return (
    <li
      className="sk-stagger-item group"
      style={{ ["--i" as string]: String(index) } as React.CSSProperties}
    >
      <div className="flex items-stretch border-b border-[rgb(var(--border-subtle))] transition-colors hover:bg-[rgb(var(--bg-overlay))]">
        {/* Selection checkbox — outside the link so a tick doesn't navigate. */}
        <label
          className="flex shrink-0 cursor-pointer items-center px-3"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${row.title}`}
            className="h-4 w-4 cursor-pointer rounded border-[rgb(var(--border-subtle))] text-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>

        <Link
          href={`/dashboard/projects/${row.id}`}
          className="flex min-h-[72px] flex-1 items-center gap-3 py-3 pe-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] sm:gap-4"
        >
          {/* Gradient badge */}
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white shadow-sm"
            style={{
              background: gradientCss(grad),
              boxShadow:
                "inset 0 1px 1px rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            <FolderIcon />
          </span>

          {/* Project + stage + comments dot */}
          <div className="min-w-0 flex-[2.2]">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold tracking-tight text-[rgb(var(--fg-primary))]">
                {row.title}
              </span>
              <span
                className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                style={{
                  color: tone.text,
                  backgroundColor: tone.bg,
                  borderColor: tone.border,
                }}
              >
                {stateLabel}
              </span>
              {row.unresolvedComments > 0 ? (
                <span
                  aria-label={`${row.unresolvedComments.toString()} unresolved comments`}
                  className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.55rem] font-bold text-[rgb(var(--fg-inverse))]"
                >
                  {row.unresolvedComments}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[0.72rem] text-[rgb(var(--fg-muted))]">
              <span className="font-semibold capitalize text-[rgb(var(--fg-secondary))]">
                {STAGE_LABEL[row.stage]}
              </span>
            </p>
          </div>

          {/* Client (hidden < md) */}
          <div className="hidden min-w-0 flex-[1.2] md:block">
            <p className="truncate text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]">
              {row.artistName}
            </p>
            <p className="truncate text-[0.62rem] text-[rgb(var(--fg-muted))]">
              {formatLastActivity(row.lastActivityIso)}
            </p>
          </div>

          {/* Progress (hidden < lg) */}
          <div className="hidden w-28 shrink-0 items-center gap-2 lg:flex">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${progress.toString()}%`,
                  background:
                    progress === 100
                      ? "rgb(var(--fg-success))"
                      : "rgb(var(--fg-primary))",
                }}
              />
            </div>
            <span className="sk-num w-8 text-right font-mono text-[0.65rem] font-bold tabular-nums text-[rgb(var(--fg-secondary))]">
              {progress}%
            </span>
          </div>

          {/* Balance (hidden < md) */}
          <div className="hidden w-20 shrink-0 text-right md:block">
            <p
              className="sk-num font-mono text-[0.78rem] font-bold tabular-nums"
              style={{
                color: owed > 0 ? "rgb(var(--fg-danger))" : "rgb(var(--fg-muted))",
              }}
            >
              {owed > 0 ? formatMoneyCompact(owed, row.currency) : "—"}
            </p>
            <p className="text-[0.55rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
              Balance
            </p>
          </div>

          {/* Deadline / next session (hidden < md) */}
          <div className="hidden w-20 shrink-0 text-right md:block">
            <p
              className="font-mono text-[0.7rem] tabular-nums"
              style={{ color: deadline.color, fontWeight: deadline.bold ? 700 : 500 }}
            >
              {deadline.label}
            </p>
            <p className="text-[0.55rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
              {deadline.subLabel}
            </p>
          </div>

          {/* Chevron */}
          <ChevronIcon />
        </Link>
      </div>
    </li>
  );
}

const DEFAULT_STATE_LABELS: Record<ProjectState, string> = {
  live: "Live",
  done: "Done",
  archived: "Archived",
};

// Compact money formatter — "$3.4k" for big balances, "$420" otherwise.
function formatMoneyCompact(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (dollars >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(dollars);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

// Render the deadline column. Priority:
//   1. Next session if booked → "in 3d" or "today" or "Tue 14:00"
//   2. No session → "X days ago" from last activity, muted.
function formatDeadline(
  nextSessionIso: string | null,
  lastActivityIso: string,
): { label: string; subLabel: string; color: string; bold: boolean } {
  const now = Date.now();
  if (nextSessionIso) {
    const next = Date.parse(nextSessionIso);
    const days = Math.round((next - now) / (24 * 60 * 60 * 1000));
    const overdue = days < 0;
    const close = days >= 0 && days <= 3;
    if (overdue) {
      return {
        label: `${Math.abs(days).toString()}d late`,
        subLabel: "Session",
        color: "rgb(var(--fg-danger))",
        bold: true,
      };
    }
    if (days === 0) {
      return {
        label: "Today",
        subLabel: "Session",
        color: "rgb(var(--fg-warning))",
        bold: true,
      };
    }
    if (close) {
      return {
        label: `${days.toString()}d`,
        subLabel: "Session",
        color: "rgb(var(--fg-warning))",
        bold: true,
      };
    }
    return {
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(next)),
      subLabel: "Session",
      color: "rgb(var(--fg-muted))",
      bold: false,
    };
  }
  const last = Date.parse(lastActivityIso);
  const daysAgo = Math.max(0, Math.round((now - last) / (24 * 60 * 60 * 1000)));
  return {
    label: daysAgo === 0 ? "Today" : `${daysAgo.toString()}d ago`,
    subLabel: "Updated",
    color: "rgb(var(--fg-muted))",
    bold: false,
  };
}

function formatLastActivity(iso: string): string {
  const ms = Date.parse(iso);
  const days = Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Last activity today";
  if (days === 1) return "Last activity yesterday";
  if (days < 7) return `Last activity ${days.toString()}d ago`;
  if (days < 30) return `Last activity ${Math.round(days / 7).toString()}w ago`;
  return `Last activity ${Math.round(days / 30).toString()}mo ago`;
}

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ms-1 shrink-0 text-[rgb(var(--fg-muted))] transition-transform group-hover:translate-x-0.5"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
