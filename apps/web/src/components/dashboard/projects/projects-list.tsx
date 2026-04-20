"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { formatRelativeTime } from "~/lib/time/relative";
import { STAGE_LABEL, VISIBLE_STAGES as STAGE_ORDER, type VisibleStage } from "~/lib/projects/stages";
import {
  PROJECT_STATES,
  STATE_LABEL,
  STATE_TONE,
  stageToState,
  type ProjectState,
} from "~/lib/projects/states";

// Batch G — the projects list now surfaces THREE display states
// instead of eight-plus stage chips. The underlying stage enum is
// untouched on the server; we just collapse it on render. The chip
// bar goes from "All + 7 stages" to "All + Live/Done/Archived".
//
// Per-row rendering keeps the fine-grained stage label small+muted
// under the bold state tag — same treatment as the Project Room
// header — so a producer who really does want to know "is this in
// final_review or in_production" can still see it without any tab
// click.

// Local alias kept for this file's existing export surface. The list
// only ever deals with Kanban-visible stages (no cancelled / paused),
// so `Stage` here is the narrower `VisibleStage`.
export type Stage = VisibleStage;

// Minimum row shape we render. Mirrors the drizzle projects row
// subset we actually use — date timestamps cross the RSC → client
// boundary as ISO strings (the page serializes them). Keeping this
// intentionally tight means we don't ship fields like shareTokenHash
// or stripe ids to the client.
export type ProjectRow = {
  id: string;
  title: string;
  artistName: string;
  stage: Stage;
  updatedAtIso: string;
};

export type GroupedProjects = Record<Stage, ProjectRow[]>;

export function ProjectsList({
  grouped,
  activeState,
}: {
  grouped: GroupedProjects;
  activeState: ProjectState | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Collapse the per-stage server grouping into per-state client
  // grouping. Each state bucket preserves the underlying stage on
  // the row so the row renderer can show it as the fine-grained
  // label under the bold state chip.
  const byState: Record<ProjectState, ProjectRow[]> = {
    live: [],
    done: [],
    archived: [],
  };
  for (const stage of STAGE_ORDER) {
    const rows = grouped[stage];
    const state = stageToState(stage);
    for (const r of rows) {
      byState[state].push(r);
    }
  }
  // Each state bucket should stay newest-updated-first. Server
  // already orders rows desc; across stages the result is consistent
  // within each state after the fold because STAGE_ORDER is stable
  // but the rows come in at the per-stage order the server gave us.
  // Re-sort to guarantee the across-stage interleave is by recency.
  for (const state of PROJECT_STATES) {
    byState[state].sort((a, b) =>
      new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
    );
  }

  const totalCount =
    byState.live.length + byState.done.length + byState.archived.length;

  const selectState = (next: ProjectState | null) => {
    const query = next ? `?state=${next}` : "";
    startTransition(() => {
      router.replace(`/dashboard/projects${query}`, { scroll: false });
    });
  };

  // Nothing across any state — offer the lead-gen funnel CTA. Magic
  // links are the upstream source of Projects, so we nudge the producer
  // back toward creating one rather than leaving them staring at a
  // blank list.
  if (totalCount === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]">
          <FolderIcon />
        </div>
        <h3 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
          No projects yet
        </h3>
        <p className="mt-2 max-w-md text-sm text-[rgb(var(--fg-secondary))]">
          Projects appear here once you create one — a shareable link is generated
          automatically for the client.
        </p>
        <Link
          href="/dashboard/projects/new"
          className="mt-6 inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Create a project
        </Link>
      </div>
    );
  }

  // States to render: just the active one if filtered, else all three
  // in declared order (live → done → archived). Empty states inside
  // each bucket are handled at the section level.
  const statesToRender: readonly ProjectState[] = activeState
    ? [activeState]
    : PROJECT_STATES;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <StateChipBar
        byState={byState}
        totalCount={totalCount}
        activeState={activeState}
        disabled={isPending}
        onSelect={selectState}
      />

      <div className="flex flex-col gap-8">
        {statesToRender.map((state) => {
          const rows = byState[state];
          if (rows.length === 0) {
            if (activeState) {
              return <StateEmpty key={state} />;
            }
            return null;
          }

          return (
            <section key={state} aria-labelledby={`state-${state}-heading`}>
              {!activeState ? (
                <h2
                  id={`state-${state}-heading`}
                  className="mb-3 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
                >
                  {STATE_LABEL[state]}{" "}
                  <span className="sk-num text-[rgb(var(--fg-secondary))]">
                    · {rows.length.toString()}
                  </span>
                </h2>
              ) : null}

              <ul
                role="list"
                className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
              >
                {rows.map((row) => (
                  <ProjectRowItem key={row.id} row={row} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chip bar ────────────────────────────────────────────────────────

function StateChipBar({
  byState,
  totalCount,
  activeState,
  disabled,
  onSelect,
}: {
  byState: Record<ProjectState, ProjectRow[]>;
  totalCount: number;
  activeState: ProjectState | null;
  disabled: boolean;
  onSelect: (state: ProjectState | null) => void;
}) {
  return (
    // Four chips on desktop, still uses the sk-scroll-x momentum rail
    // on mobile. Far less cramped than the old 8-chip version — the
    // whole thing fits without scrolling on any realistic screen.
    <nav aria-label="Filter by state" className="-mx-4 sm:mx-0">
      <div className="sk-scroll-x flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Chip
          label="All"
          count={totalCount}
          active={activeState === null}
          disabled={disabled}
          onClick={() => {
            onSelect(null);
          }}
        />
        {PROJECT_STATES.map((state) => (
          <Chip
            key={state}
            label={STATE_LABEL[state]}
            count={byState[state].length}
            active={activeState === state}
            disabled={disabled}
            onClick={() => {
              onSelect(state);
            }}
          />
        ))}
      </div>
    </nav>
  );
}

function Chip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={[
        // Four chips fit comfortably without the mobile-only min-h
        // crammed feel of the old 8-chip rail. Touch target still
        // ≥44px on mobile.
        "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors sm:min-h-0 sm:h-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <span
        className={[
          "sk-num font-mono text-[0.66rem]",
          active ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {count.toString()}
      </span>
    </button>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────

function ProjectRowItem({ row }: { row: ProjectRow }) {
  const state = stageToState(row.stage);
  const tone = STATE_TONE[state];
  return (
    <li>
      <Link
        href={`/dashboard/projects/${row.id}`}
        // min-h-[56px] mirrors the Today inbox rows for consistency —
        // a 2-line row (title + artist/state-badge) needs the vertical
        // room or the badge crowds the row baseline. Inset focus ring
        // stays clipped to the row.
        className="flex min-h-[56px] items-start gap-3 px-4 py-3 transition-colors hover:bg-[rgb(var(--bg-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
              {row.title}
            </p>
            <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
              {formatRelativeTime(new Date(row.updatedAtIso))}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate text-xs text-[rgb(var(--fg-secondary))]">
              {row.artistName}
            </p>
            <span
              className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.1em]"
              style={{
                color: tone.text,
                backgroundColor: tone.bg,
                borderColor: tone.border,
              }}
            >
              {STATE_LABEL[state]}
            </span>
            {/* Secondary: the fine-grained stage, muted. Hidden when
                the state label is already the same word (e.g. the
                `archived` stage → "Archived" state), otherwise shown
                in the muted font-mono style used for timestamps. */}
            {STAGE_LABEL[row.stage] !== STATE_LABEL[state] ? (
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                · {STAGE_LABEL[row.stage]}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

// ─── Sub-states ──────────────────────────────────────────────────────

function StateEmpty() {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        No projects in this state.{" "}
        <Link
          href="/dashboard/projects"
          className="text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
          scroll={false}
        >
          Show all
        </Link>
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M7 5V3h6v2" />
      <path d="M2.5 10h19" />
    </svg>
  );
}
