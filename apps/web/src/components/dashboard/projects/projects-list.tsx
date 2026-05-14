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
import { formatMoney } from "~/lib/format/money";
import { gradientCss, gradientFor } from "~/lib/project-gradient";
// Note: removed formatRelativeTime — replaced by formatLastActivityShort
// (file-local) which produces "Active 3d ago" sub-labels for the new
// row layout.
import { STAGE_LABEL, VISIBLE_STAGES as STAGE_ORDER, type VisibleStage } from "~/lib/projects/stages";
import {
  PROJECT_STATES,
  STATE_LABEL,
  STATE_TONE,
  stageToState,
  type ProjectState,
} from "~/lib/projects/states";
import { bulkSetProjectStage } from "~/app/(producer)/dashboard/clients-projects/actions";

// Heuristic mapping from stage → progress percentage. The HTML mockup
// shows real progress bars; we don't track sub-stage completion in the
// data model, so we project the funnel position to a percentage.
// Producers get a visual scan-rhythm without over-promising precision.
const STAGE_PROGRESS: Record<VisibleStage, number> = {
  lead: 12,
  booked: 30,
  in_production: 55,
  final_review: 80,
  paid: 100,
  archived: 100,
};

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
//
// 2026-05-06 redesign: enriched with money + activity signals so the
// row can show the HTML-mockup columns (Balance / Deadline / unread
// dot) without a second tRPC call from the client.
export type ProjectRow = {
  id: string;
  title: string;
  artistName: string;
  stage: Stage;
  updatedAtIso: string;
  // Enrichment fields. All optional + nullable so legacy callers (and
  // tests) don't need to populate them; the row degrades gracefully.
  outstandingCents?: number;
  nextSessionAtIso?: string | null;
  unresolvedComments?: number;
  currency?: string;
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
      router.replace(`/dashboard/clients-projects${query}`, { scroll: false });
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
          href="/dashboard/clients-projects/new"
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
  const grad = gradientFor(row.id);
  const progress = STAGE_PROGRESS[row.stage];
  const owed = row.outstandingCents ?? 0;
  const currency = row.currency ?? "USD";
  const deadline = formatDeadline(row.nextSessionAtIso ?? null, row.updatedAtIso);
  const unread = row.unresolvedComments ?? 0;

  return (
    <li
      className="sk-stagger-item group"
      style={{ ["--i" as string]: String(index) } as React.CSSProperties}
    >
      <div className="flex items-stretch transition-colors hover:bg-[rgb(var(--bg-overlay))]">
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
          href={`/dashboard/clients-projects/${row.id}`}
          className="flex min-h-[68px] flex-1 items-center gap-3 py-3 pe-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] sm:gap-4"
        >
          {/* Gradient project badge */}
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-white shadow-sm"
            style={{
              background: gradientCss(grad),
              boxShadow:
                "inset 0 1px 1px rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            <FolderBadgeIcon />
          </span>

          {/* Title + state pill + stage label + unread dot */}
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
              {unread > 0 ? (
                <span
                  aria-label={`${unread.toString()} unresolved comments`}
                  className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.55rem] font-bold text-[rgb(var(--fg-inverse))]"
                >
                  {unread}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[0.72rem] text-[rgb(var(--fg-muted))]">
              {STAGE_LABEL[row.stage] !== STATE_LABEL[state] ? (
                <span className="font-semibold capitalize text-[rgb(var(--fg-secondary))]">
                  {STAGE_LABEL[row.stage]}
                </span>
              ) : (
                <span className="font-semibold text-[rgb(var(--fg-secondary))]">
                  {stateLabel}
                </span>
              )}
            </p>
          </div>

          {/* Client (hidden < md) */}
          <div className="hidden min-w-0 flex-[1.2] md:block">
            <p className="truncate text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]">
              {row.artistName}
            </p>
            <p className="truncate text-[0.62rem] text-[rgb(var(--fg-muted))]">
              {formatLastActivityShort(row.updatedAtIso)}
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
              {owed > 0 ? formatMoney(owed, currency) : "—"}
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

          <ChevronRightIcon />
        </Link>
      </div>
    </li>
  );
}

// Render the deadline column. Priority:
//   1. Next session if booked → "today" / "3d" / "Tue 14"
//   2. No session → "Xd ago" from last activity, muted.
function formatDeadline(
  nextSessionIso: string | null,
  lastActivityIso: string,
): { label: string; subLabel: string; color: string; bold: boolean } {
  const now = Date.now();
  if (nextSessionIso) {
    const next = Date.parse(nextSessionIso);
    const days = Math.round((next - now) / (24 * 60 * 60 * 1000));
    if (days < 0) {
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
    if (days <= 3) {
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

function formatLastActivityShort(iso: string): string {
  const ms = Date.parse(iso);
  const days = Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  if (days < 7) return `Active ${days.toString()}d ago`;
  if (days < 30) return `Active ${Math.round(days / 7).toString()}w ago`;
  return `Active ${Math.round(days / 30).toString()}mo ago`;
}

function FolderBadgeIcon() {
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

function ChevronRightIcon() {
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

// ─── Sub-states ──────────────────────────────────────────────────────

function StateEmpty({ emptyState, showAll }: { emptyState: string; showAll: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        {emptyState}{" "}
        <Link
          href="/dashboard/clients-projects"
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
