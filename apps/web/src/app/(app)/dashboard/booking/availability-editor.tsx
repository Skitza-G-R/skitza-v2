"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { setAvailabilityWeek } from "./actions";

// Multi-block availability with a Notion/Linear-style day-tab pattern:
// 7 weekday chips at the top (Mon..Sun), only the selected day's
// editor renders below. A small dot under each chip signals which days
// already have windows so producers can scan their week without
// clicking each tab. Pre-2026-04-25 this rendered all 7 days stacked
// vertically — a long-scroll mobile layout that ate the entire fold
// on desktop.

// ── Types ───────────────────────────────────────────────────────────

interface DraftBlock {
  // Stable id for React keys — a counter so React doesn't thrash when
  // blocks are added/removed (indexes would cause input focus loss).
  id: string;
  startMin: number;
  endMin: number;
}

type Draft = Record<number, DraftBlock[]>; // keyed by weekday (0-6)

// Stored blocks from the server — stable shape used for rehydration.
type StoredBlock = { weekday: number; startMin: number; endMin: number };

// Min block duration in minutes — below this, warn but don't hard-block.
const MIN_BLOCK_DURATION_MIN = 30;

// Absolute safety cap so superRefine max(35) never fires via UI.
const MAX_BLOCKS_PER_DAY = 5;

const WEEKDAYS = [
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
  { num: 0, label: "Sun" },
] as const;

// Module-scope counter for DraftBlock ids. We only need stable within
// a single client session.
let nextBlockId = 1;
function makeId(): string {
  nextBlockId += 1;
  return `blk-${String(nextBlockId)}`;
}

// ── Pure helpers ────────────────────────────────────────────────────

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMin(v: string): number {
  const [h = "0", m = "0"] = v.split(":");
  return Number(h) * 60 + Number(m);
}

function buildDraft(blocks: readonly StoredBlock[]): Draft {
  const out: Draft = {};
  for (const { num } of WEEKDAYS) out[num] = [];
  for (const b of [...blocks].sort((a, b) => a.startMin - b.startMin)) {
    const list = out[b.weekday];
    if (!list) continue;
    list.push({ id: makeId(), startMin: b.startMin, endMin: b.endMin });
  }
  return out;
}

// Serialize to the shape the server expects.
function serializeDraft(d: Draft): StoredBlock[] {
  const out: StoredBlock[] = [];
  for (const { num } of WEEKDAYS) {
    const list = d[num] ?? [];
    for (const b of list) {
      out.push({ weekday: num, startMin: b.startMin, endMin: b.endMin });
    }
  }
  return out;
}

// Structural compare of two serialized forms (for dirty check).
function sameBlocks(a: readonly StoredBlock[], b: readonly StoredBlock[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (xs: readonly StoredBlock[]) =>
    [...xs]
      .sort((x, y) =>
        x.weekday - y.weekday !== 0 ? x.weekday - y.weekday : x.startMin - y.startMin,
      )
      .map((x) => `${String(x.weekday)}:${String(x.startMin)}:${String(x.endMin)}`)
      .join("|");
  return norm(a) === norm(b);
}

// Is this single block valid (start < end)?
function blockValid(b: DraftBlock): boolean {
  return b.startMin < b.endMin;
}

// Does this block overlap any other block on the same day? Pure.
function overlapsWithin(list: readonly DraftBlock[], idx: number): boolean {
  const self = list[idx];
  if (!self || !blockValid(self)) return false;
  for (let j = 0; j < list.length; j++) {
    if (j === idx) continue;
    const other = list[j];
    if (!other || !blockValid(other)) continue;
    if (self.startMin < other.endMin && other.startMin < self.endMin) return true;
  }
  return false;
}

// Pick the day to land on when the editor first mounts. We prefer
// today (so a producer opening Setup on Friday sees Friday hours
// first) but fall back to the first weekday that already has windows
// configured — and finally to Monday if everything is empty. Pure so
// it can be tested without React or state.
export function defaultSelectedDay(
  draft: Draft,
  todayDow: number,
): number {
  if ((draft[todayDow] ?? []).length > 0) return todayDow;
  for (const { num } of WEEKDAYS) {
    if ((draft[num] ?? []).length > 0) return num;
  }
  return todayDow;
}

// ── Presets ─────────────────────────────────────────────────────────
// Each preset is a list of (weekday, startMin, endMin) tuples. Applied
// wholesale — overwrites the current draft when confirmed.

type Preset = {
  key: string;
  label: string;
  description: string;
  blocks: StoredBlock[];
};

const MON_FRI = [1, 2, 3, 4, 5] as const;
const SAT_SUN = [6, 0] as const;

function mk(weekday: number, sh: number, eh: number): StoredBlock {
  return { weekday, startMin: sh * 60, endMin: eh * 60 };
}

const PRESETS: Preset[] = [
  {
    key: "9to6",
    label: "9–6 Mon–Fri",
    description: "One block per weekday, 9:00 to 18:00.",
    blocks: MON_FRI.map((d) => mk(d, 9, 18)),
  },
  {
    key: "two-session",
    label: "Two-session days",
    description: "Morning + afternoon Mon–Fri (9–12 / 14–17).",
    blocks: MON_FRI.flatMap((d) => [mk(d, 9, 12), mk(d, 14, 17)]),
  },
  {
    key: "studio-hours",
    label: "Studio hours",
    description: "Three blocks Mon–Fri (9–12 / 14–17 / 18–21).",
    blocks: MON_FRI.flatMap((d) => [mk(d, 9, 12), mk(d, 14, 17), mk(d, 18, 21)]),
  },
  {
    key: "weekend-evenings",
    label: "Weekends + evenings",
    description: "Sat/Sun 10–8 + Mon–Fri 18–22.",
    blocks: [
      ...SAT_SUN.flatMap((d) => [mk(d, 10, 20)]),
      ...MON_FRI.flatMap((d) => [mk(d, 18, 22)]),
    ],
  },
  {
    key: "clear",
    label: "Clear all",
    description: "Remove every block.",
    blocks: [],
  },
];

// ── Component ───────────────────────────────────────────────────────

export function AvailabilityEditor({
  initialBlocks,
}: {
  initialBlocks: StoredBlock[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => buildDraft(initialBlocks));

  // Selected day for the day-tab pattern. Initialised once based on
  // today + which days already have windows; producers can switch tabs
  // freely after that. Using a lazy initialiser keeps the new Date()
  // call out of every re-render.
  const [selectedDay, setSelectedDay] = useState<number>(() =>
    defaultSelectedDay(buildDraft(initialBlocks), new Date().getDay()),
  );

  // Confirmation affordance for destructive preset application.
  const [pendingPreset, setPendingPreset] = useState<Preset | null>(null);

  const serialized = useMemo(() => serializeDraft(draft), [draft]);

  const isDirty = useMemo(
    () => !sameBlocks(serialized, initialBlocks),
    [serialized, initialBlocks],
  );

  // Aggregate error state — any invalid row blocks the save button.
  const errors = useMemo(() => {
    const errs: {
      weekday: number;
      blockId: string;
      kind: "overlap" | "invalid" | "short";
    }[] = [];
    for (const { num } of WEEKDAYS) {
      const list = draft[num] ?? [];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b) continue;
        if (!blockValid(b)) {
          errs.push({ weekday: num, blockId: b.id, kind: "invalid" });
          continue;
        }
        if (overlapsWithin(list, i)) {
          errs.push({ weekday: num, blockId: b.id, kind: "overlap" });
        } else if (b.endMin - b.startMin < MIN_BLOCK_DURATION_MIN) {
          errs.push({ weekday: num, blockId: b.id, kind: "short" });
        }
      }
    }
    return errs;
  }, [draft]);

  // Only overlap + invalid block save; "short" is a soft warning.
  const hasBlockingError = errors.some((e) => e.kind !== "short");

  function updateBlock(weekday: number, blockId: string, patch: Partial<DraftBlock>) {
    setDraft((d) => {
      const list = d[weekday] ?? [];
      return {
        ...d,
        [weekday]: list.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
      };
    });
  }

  function removeBlock(weekday: number, blockId: string) {
    setDraft((d) => {
      const list = d[weekday] ?? [];
      return { ...d, [weekday]: list.filter((b) => b.id !== blockId) };
    });
  }

  function addBlock(weekday: number) {
    setDraft((d) => {
      const list = d[weekday] ?? [];
      if (list.length >= MAX_BLOCKS_PER_DAY) return d;
      // Default new block: start at previous block's end, length 2h,
      // capped at end-of-day. If no previous block, default 09:00-12:00.
      const last = list[list.length - 1];
      const start = last ? last.endMin : 9 * 60;
      const end = Math.min(start + 2 * 60, 24 * 60);
      const safeStart = start >= 24 * 60 ? 22 * 60 : start;
      const safeEnd = safeStart >= end ? Math.min(safeStart + 60, 24 * 60) : end;
      return {
        ...d,
        [weekday]: [...list, { id: makeId(), startMin: safeStart, endMin: safeEnd }],
      };
    });
  }

  // Copy one weekday's block list to every other weekday.
  function copyToAllWeekdays(sourceWeekday: number) {
    setDraft((d) => {
      const src = (d[sourceWeekday] ?? []).map((b) => ({
        id: makeId(),
        startMin: b.startMin,
        endMin: b.endMin,
      }));
      const next: Draft = { ...d };
      for (const { num } of WEEKDAYS) {
        if (num === sourceWeekday) continue;
        next[num] = src.map((b) => ({
          id: makeId(),
          startMin: b.startMin,
          endMin: b.endMin,
        }));
      }
      return next;
    });
  }

  // Fast "clear this day".
  function clearDay(weekday: number) {
    setDraft((d) => ({ ...d, [weekday]: [] }));
  }

  function applyPreset(preset: Preset) {
    setDraft(buildDraft(preset.blocks));
    setPendingPreset(null);
    toast(`Preset applied: ${preset.label}`, "info");
  }

  function onSave() {
    if (hasBlockingError) {
      toast("Fix the highlighted blocks before saving.", "error");
      return;
    }
    const blocks = serialized;
    startTransition(async () => {
      const res = await setAvailabilityWeek({ blocks });
      if (res.ok) {
        toast("Hours saved. Clients see updated slots on your booking page.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  const selectedList = draft[selectedDay] ?? [];
  const selectedLabel =
    WEEKDAYS.find((w) => w.num === selectedDay)?.label ?? "Mon";

  // Pre-compute "errors on this day" so we can dot the chip when the
  // selected tab isn't the one with the broken row. Producers shouldn't
  // have to hunt across tabs to find what's blocking save.
  const errorDays = useMemo(() => {
    const days = new Set<number>();
    for (const e of errors) {
      if (e.kind !== "short") days.add(e.weekday);
    }
    return days;
  }, [errors]);

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <h3
            className="text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]"
          >
            Presets
          </h3>
          <span className="text-[0.66rem] text-[rgb(var(--fg-muted))]">
            Overwrites your current schedule
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const isPending = pendingPreset?.key === p.key;
            if (isPending) {
              return (
                <div
                  key={p.key}
                  className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-2 py-1"
                >
                  <span className="text-xs text-[rgb(var(--fg-secondary))]">
                    Apply{" "}
                    <span className="font-mono text-[rgb(var(--fg-primary))]">
                      {p.label}
                    </span>
                    ?
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      applyPreset(p);
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    Apply
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPendingPreset(null);
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              );
            }
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setPendingPreset(p);
                }}
                title={p.description}
                className="h-7 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2.5 text-xs text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day-tab strip */}
      <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-1.5">
        <nav
          aria-label="Pick a day to edit"
          role="tablist"
          className="flex gap-1"
        >
          {WEEKDAYS.map(({ num, label }) => {
            const list = draft[num] ?? [];
            const hasWindows = list.length > 0;
            const hasError = errorDays.has(num);
            const isActive = selectedDay === num;
            return (
              <button
                key={num}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`day-panel-${String(num)}`}
                id={`day-tab-${String(num)}`}
                onClick={() => {
                  setSelectedDay(num);
                }}
                className={[
                  "relative flex h-9 flex-1 flex-col items-center justify-center rounded-[var(--radius-sm)] px-1 text-[0.72rem] font-mono uppercase tracking-wider transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                  isActive
                    ? "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]"
                    : hasWindows
                    ? "text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-base))]"
                    : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-base))]",
                ].join(" ")}
              >
                <span>{label}</span>
                {/* Indicator dot:
                    - red if this day has a blocking error (so producers can
                      jump straight to the broken tab)
                    - brand-color filled if the day has windows
                    - hidden if the day is empty
                */}
                {hasError ? (
                  <span
                    aria-hidden
                    className="mt-0.5 h-1 w-1 rounded-full bg-[rgb(var(--fg-danger))]"
                  />
                ) : hasWindows ? (
                  <span
                    aria-hidden
                    className="mt-0.5 h-1 w-1 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : (
                  <span aria-hidden className="mt-0.5 h-1 w-1" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Selected day editor */}
      <div
        id={`day-panel-${String(selectedDay)}`}
        role="tabpanel"
        aria-labelledby={`day-tab-${String(selectedDay)}`}
        key={selectedDay}
        className="reveal-up rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-2.5"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[0.78rem] font-semibold text-[rgb(var(--fg-primary))]">
              {selectedLabel}
            </h3>
            <span className="text-[0.66rem] text-[rgb(var(--fg-muted))]">
              {selectedList.length === 0
                ? "Closed"
                : `${String(selectedList.length)} window${selectedList.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                addBlock(selectedDay);
              }}
              disabled={selectedList.length >= MAX_BLOCKS_PER_DAY}
              aria-label={`Add a window on ${selectedLabel}`}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-xs text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            >
              <PlusIcon />
              Add
            </button>
            {selectedList.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    copyToAllWeekdays(selectedDay);
                  }}
                  title={`Copy ${selectedLabel} windows to every other weekday`}
                  aria-label={`Copy ${selectedLabel} schedule to every weekday`}
                  className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-base))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
                >
                  <CopyIcon />
                  Copy to all
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearDay(selectedDay);
                  }}
                  aria-label={`Clear all windows on ${selectedLabel}`}
                  className="inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2 text-xs text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-base))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
                >
                  Clear
                </button>
              </>
            ) : null}
          </div>
        </div>

        {selectedList.length === 0 ? (
          <p className="py-2 text-xs text-[rgb(var(--fg-muted))]">
            Closed. Add a window to open {selectedLabel} for booking.
          </p>
        ) : (
          <div className="space-y-1.5">
            {selectedList.map((b, idx) => {
              const rowErr = errors.find((e) => e.blockId === b.id);
              return (
                <BlockRow
                  key={b.id}
                  block={b}
                  errorKind={rowErr?.kind}
                  onChange={(patch) => {
                    updateBlock(selectedDay, b.id, patch);
                  }}
                  onRemove={() => {
                    removeBlock(selectedDay, b.id);
                  }}
                  weekdayLabel={selectedLabel}
                  idx={idx}
                />
              );
            })}
          </div>
        )}
        {selectedList.length >= MAX_BLOCKS_PER_DAY ? (
          <p className="mt-2 text-[0.66rem] text-[rgb(var(--fg-muted))]">
            Max {String(MAX_BLOCKS_PER_DAY)} per day
          </p>
        ) : null}
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.85)] px-3 py-2 backdrop-blur">
        <p className="text-xs text-[rgb(var(--fg-muted))]">
          {hasBlockingError
            ? "Fix errors to save"
            : isDirty
            ? "Unsaved changes"
            : "No changes"}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={pending || !isDirty || hasBlockingError}
          className="h-8"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function BlockRow({
  block,
  errorKind,
  onChange,
  onRemove,
  weekdayLabel,
  idx,
}: {
  block: DraftBlock;
  errorKind: "overlap" | "invalid" | "short" | undefined;
  onChange: (patch: Partial<DraftBlock>) => void;
  onRemove: () => void;
  weekdayLabel: string;
  idx: number;
}) {
  const isHardError = errorKind === "invalid" || errorKind === "overlap";
  const errorBorder = isHardError
    ? "border-[rgb(var(--fg-danger))]"
    : "border-[rgb(var(--border-subtle))]";
  const errorMsg =
    errorKind === "invalid"
      ? "Start must be before end."
      : errorKind === "overlap"
      ? "Overlaps another window."
      : errorKind === "short"
      ? `Shorter than ${String(MIN_BLOCK_DURATION_MIN)} min.`
      : null;
  return (
    <div
      className={[
        "inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border bg-[rgb(var(--bg-base))] px-1.5 py-1",
        errorBorder,
      ].join(" ")}
    >
      <input
        type="time"
        value={minToHHMM(block.startMin)}
        onChange={(e) => {
          onChange({ startMin: hhmmToMin(e.target.value) });
        }}
        aria-label={`${weekdayLabel} window ${String(idx + 1)} start time`}
        aria-invalid={isHardError}
        // text-base avoids iOS zoom-on-focus (<16px triggers zoom).
        // w-[7.5rem] reserves room for the value + the native time
        // picker's clock icon — anything tighter clips the value.
        className="h-8 w-[7.5rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 font-mono text-base text-[rgb(var(--fg-primary))]"
      />
      <span className="text-xs text-[rgb(var(--fg-muted))]">–</span>
      <input
        type="time"
        value={minToHHMM(block.endMin)}
        onChange={(e) => {
          onChange({ endMin: hhmmToMin(e.target.value) });
        }}
        aria-label={`${weekdayLabel} window ${String(idx + 1)} end time`}
        aria-invalid={isHardError}
        className="h-8 w-[7.5rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 font-mono text-base text-[rgb(var(--fg-primary))]"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${weekdayLabel} window ${String(idx + 1)}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] hover:text-[rgb(var(--fg-danger))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        <TrashIcon />
      </button>
      {errorMsg ? (
        <p
          role={isHardError ? "alert" : undefined}
          className={[
            "basis-full text-[0.66rem]",
            isHardError
              ? "text-[rgb(var(--fg-danger))]"
              : "text-[rgb(var(--fg-muted))]",
          ].join(" ")}
        >
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="6" y="6" width="10" height="10" rx="1.5" />
      <path d="M4 4h10v2M4 4v10h2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        d="M5 6h10M8 6V4h4v2M7 6l1 10h4l1-10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
