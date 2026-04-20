"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  BulkActionBar,
  useBulkSelection,
  useEscClearsSelection,
} from "~/components/ui/bulk-action-bar";
import {
  ListSearchInput,
  listSearchMatches,
  useListSearch,
} from "~/components/ui/list-search";
import { useToast } from "~/components/ui/toast";
import { formatRelativeTime } from "~/lib/time/relative";
import { STAGE_LABEL, VISIBLE_STAGES as STAGE_ORDER, type VisibleStage } from "~/lib/projects/stages";
import {
  PROJECT_STATES,
  STATE_LABEL,
  STATE_TONE,
  stageToState,
  type ProjectState,
} from "~/lib/projects/states";
import { bulkSetProjectStage } from "~/app/(app)/dashboard/projects/actions";

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
  const [isBulkPending, startBulkTransition] = useTransition();
  const { value: q, setValue: setQ, inputRef } = useListSearch();
  const { toast } = useToast();
  const tP = useTranslations("projects");
  const tState = useTranslations("projects.state");
  const tBulk = useTranslations("projects.bulk");
  const { selection, toggle, setMany, clear } = useBulkSelection();
  useEscClearsSelection(selection.size > 0, clear);

  // Collapse the per-stage server grouping into per-state client
  // grouping. Each state bucket preserves the underlying stage on
  // the row so the row renderer can show it as the fine-grained
  // label under the bold state chip.
  const { byState, totalCount, unfilteredTotalCount } = useMemo(() => {
    const out: Record<ProjectState, ProjectRow[]> = {
      live: [],
      done: [],
      archived: [],
    };
    let unfiltered = 0;
    for (const stage of STAGE_ORDER) {
      const rows = grouped[stage];
      const state = stageToState(stage);
      for (const r of rows) {
        unfiltered += 1;
        // Apply the inline search filter at bucket time so the chip
        // counts reflect what the producer is actually scanning. An
        // empty q matches all rows via `listSearchMatches`.
        if (listSearchMatches(q, [r.title, r.artistName, STAGE_LABEL[r.stage]])) {
          out[state].push(r);
        }
      }
    }
    // Each state bucket should stay newest-updated-first. Server
    // already orders rows desc; across stages the result is consistent
    // within each state after the fold because STAGE_ORDER is stable
    // but the rows come in at the per-stage order the server gave us.
    // Re-sort to guarantee the across-stage interleave is by recency.
    for (const state of PROJECT_STATES) {
      out[state].sort(
        (a, b) =>
          new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
      );
    }
    const total = out.live.length + out.done.length + out.archived.length;
    return { byState: out, totalCount: total, unfilteredTotalCount: unfiltered };
  }, [grouped, q]);

  const selectState = (next: ProjectState | null) => {
    const query = next ? `?state=${next}` : "";
    startTransition(() => {
      router.replace(`/dashboard/projects${query}`, { scroll: false });
    });
  };

  // Nothing across any state — offer the lead-gen funnel CTA. Magic
  // links are the upstream source of Projects, so we nudge the producer
  // back toward creating one rather than leaving them staring at a
  // blank list. `unfilteredTotalCount` avoids swapping to this empty
  // state when the producer has typed a non-matching query (we want
  // the "no matches" inline nudge in that case, not the CTA).
  if (unfilteredTotalCount === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]">
          <FolderIcon />
        </div>
        <h3 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
          {tP("empty.title")}
        </h3>
        <p className="mt-2 max-w-md text-sm text-[rgb(var(--fg-secondary))]">
          {tP("empty.description")}
        </p>
        <Link
          href="/dashboard/projects/new"
          className="mt-6 inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          {tP("empty.cta")}
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

  // Flat list of every id visible across the rendered states, used by
  // the select-all checkbox + bulk actions.
  const visibleIds: string[] = statesToRender.flatMap((s) =>
    byState[s].map((r) => r.id),
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setMany(visibleIds, false);
    } else {
      setMany(visibleIds, true);
    }
  };

  // Shared dispatcher for archive / mark-done. Optimistic-ish: the
  // server-action revalidates /dashboard/projects on success so the
  // rows refresh with their new stage. Clearing the selection after
  // the mutation matches the Gmail "selection is gone once the action
  // ran" convention.
  const runBulkStage = (stage: "archived" | "paid") => {
    const ids = Array.from(selection);
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      const res = await bulkSetProjectStage({ ids, stage });
      if (res.ok) {
        // Keep the plural "s" English-only for now — Hebrew pluralisation
        // is rule-based (no simple +s) and deserves a proper `t.rich`
        // pass in a follow-up. See Commit 2 scope note in the PR doc.
        toast(
          `${stage === "archived" ? tBulk("archived") : tBulk("markedDone")} · ${String(ids.length)} project${
            ids.length === 1 ? "" : "s"
          }.`,
          "success",
        );
        clear();
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="sm:max-w-xs sm:flex-1">
          <ListSearchInput
            value={q}
            onChange={setQ}
            inputRef={inputRef}
            placeholder={tP("search")}
            ariaLabel={tP("search")}
          />
        </div>
        <div className="min-w-0 sm:flex-1">
          <StateChipBar
            byState={byState}
            totalCount={totalCount}
            activeState={activeState}
            disabled={isPending}
            onSelect={selectState}
          />
        </div>
      </div>

      {totalCount === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
        >
          {tP("noMatches")} “{q}”.
        </div>
      ) : null}

      {visibleIds.length > 0 ? (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-[rgb(var(--fg-secondary))]">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAll}
            aria-label={tP("selectAll")}
            className="h-4 w-4 cursor-pointer rounded border-[rgb(var(--border-subtle))] text-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
          {tP("selectAll")} ({String(visibleIds.length)})
        </label>
      ) : null}

      <div className="flex flex-col gap-8">
        {statesToRender.map((state) => {
          const rows = byState[state];
          if (rows.length === 0) {
            if (activeState) {
              return (
                <StateEmpty
                  key={state}
                  emptyState={tP("emptyState")}
                  showAll={tP("showAll")}
                />
              );
            }
            return null;
          }

          return (
            <section key={state} aria-labelledby={`state-${state}-heading`}>
              {!activeState ? (
                <div className="mb-3 flex items-baseline gap-3 border-b border-[rgb(var(--border-subtle))] pb-2">
                  <h2
                    id={`state-${state}-heading`}
                    className="font-display text-xl tracking-tight text-[rgb(var(--fg-primary))]"
                  >
                    {tState(state)}
                  </h2>
                  <span className="sk-num font-mono text-xs text-[rgb(var(--fg-muted))]">
                    {rows.length.toString()}
                  </span>
                </div>
              ) : null}

              {/* Batch C — shed the card frame, keep the per-row
                  hairline divider. Rows are dense list items, not
                  cards, so framing them in a bordered box reads as
                  a dated "table widget." */}
              <ul
                role="list"
                className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]"
              >
                {rows.map((row, i) => (
                  <ProjectRowItem
                    key={row.id}
                    row={row}
                    index={i}
                    selected={selection.has(row.id)}
                    onToggle={() => {
                      toggle(row.id);
                    }}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <BulkActionBar
        count={selection.size}
        onDismiss={clear}
        actions={[
          {
            id: "mark-done",
            label: tBulk("markDone"),
            tone: "primary",
            disabled: isBulkPending,
            onClick: () => {
              runBulkStage("paid");
            },
          },
          {
            id: "archive",
            label: tBulk("archive"),
            tone: "destructive",
            disabled: isBulkPending,
            onClick: () => {
              runBulkStage("archived");
            },
          },
        ]}
      />
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
  const tState = useTranslations("projects.state");
  return (
    // Four chips on desktop, still uses the sk-scroll-x momentum rail
    // on mobile. Far less cramped than the old 8-chip version — the
    // whole thing fits without scrolling on any realistic screen.
    <nav aria-label="Filter by state" className="-mx-4 sm:mx-0">
      <div className="sk-scroll-x flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Chip
          label={tState("all")}
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
            label={tState(state)}
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

function ProjectRowItem({
  row,
  index,
  selected,
  onToggle,
}: {
  row: ProjectRow;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const tState = useTranslations("projects.state");
  const state = stageToState(row.stage);
  const tone = STATE_TONE[state];
  const stateLabel = tState(state);
  return (
    <li
      className="sk-stagger-item flex items-stretch"
      style={{ ["--i" as string]: String(index) } as React.CSSProperties}
    >
      {/* Checkbox sits outside the Link so a tick doesn't navigate. */}
      <label
        className="flex shrink-0 cursor-pointer items-center ps-2 pe-1"
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
        // Batch C — rows live un-framed now, so the hover wash has to
        // be strong enough to read on its own. min-h-[64px] matches
        // Today's inbox rhythm so the three list surfaces (Today,
        // Projects, Music grid) feel like one app.
        className="flex min-h-[64px] flex-1 items-start gap-3 px-2 py-4 transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[0.95rem] font-semibold leading-6 text-[rgb(var(--fg-primary))]">
              {row.title}
            </p>
            <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
              {formatRelativeTime(new Date(row.updatedAtIso))}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate text-sm text-[rgb(var(--fg-secondary))]">
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
              {stateLabel}
            </span>
            {/* Secondary: the fine-grained stage, muted. Hidden when
                the state label is already the same word (e.g. the
                `archived` stage → "Archived" state), otherwise shown
                in the muted font-mono style used for timestamps.
                STAGE_LABEL + STATE_LABEL still used for the dedupe check
                — they're English source constants; translated display
                uses `stateLabel`. Translating STAGE_LABEL is a follow-up
                (lots of fine-grained funnel labels). */}
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

function StateEmpty({ emptyState, showAll }: { emptyState: string; showAll: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        {emptyState}{" "}
        <Link
          href="/dashboard/projects"
          className="text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
          scroll={false}
        >
          {showAll}
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
