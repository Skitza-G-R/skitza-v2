"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { setAvailabilityWeek } from "./actions";

// Multi-block availability: each weekday holds a dynamic list of
// start/end time blocks. Producers can have e.g. a morning, afternoon,
// and evening block on the same day ("studio hours") without being
// capped at two. Times are minutes-from-day-start; UI renders `HH:MM`.

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
    label: "9am–6pm Mon-Fri",
    description: "One block per weekday, 9:00 to 18:00.",
    blocks: MON_FRI.map((d) => mk(d, 9, 18)),
  },
  {
    key: "two-session",
    label: "Two-session days (9-12 / 14-17)",
    description: "Morning + afternoon blocks Mon-Fri.",
    blocks: MON_FRI.flatMap((d) => [mk(d, 9, 12), mk(d, 14, 17)]),
  },
  {
    key: "studio-hours",
    label: "Studio hours (9-12 / 14-17 / 18-21)",
    description: "Three blocks Mon-Fri.",
    blocks: MON_FRI.flatMap((d) => [mk(d, 9, 12), mk(d, 14, 17), mk(d, 18, 21)]),
  },
  {
    key: "weekend-evenings",
    label: "Weekend + evenings",
    description: "Sat/Sun full days + Mon-Fri evenings.",
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

  return (
    <div className="space-y-4">
      {/* Presets */}
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]" style={{ fontWeight: 700 }}>
              Presets
            </h3>
            <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
              Starting points for common weekly patterns. Applying overwrites your current blocks.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {PRESETS.map((p) => {
            const isPending = pendingPreset?.key === p.key;
            if (isPending) {
              return (
                <div
                  key={p.key}
                  className="flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-overlay))] px-3 py-1.5"
                >
                  <span className="text-xs text-[rgb(var(--fg-secondary))]">
                    Apply <span className="font-mono text-[rgb(var(--fg-primary))]">{p.label}</span>?
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      applyPreset(p);
                    }}
                    className="min-h-9"
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
                    className="min-h-9"
                  >
                    Cancel
                  </Button>
                </div>
              );
            }
            return (
              <Button
                key={p.key}
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 justify-start text-left"
                onClick={() => {
                  setPendingPreset(p);
                }}
                title={p.description}
              >
                {p.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Weekday rows */}
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <div className="divide-y divide-[rgb(var(--border-subtle))]">
          {WEEKDAYS.map(({ num, label }) => {
            const list = draft[num] ?? [];
            return (
              <div
                key={num}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="w-12 flex-shrink-0 pt-2 font-mono text-sm text-[rgb(var(--fg-primary))]">
                  {label}
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {list.length === 0 ? (
                    <div className="flex min-h-11 items-center font-mono text-xs uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                      Off
                    </div>
                  ) : (
                    list.map((b, idx) => {
                      const rowErr = errors.find((e) => e.blockId === b.id);
                      return (
                        <BlockRow
                          key={b.id}
                          block={b}
                          errorKind={rowErr?.kind}
                          onChange={(patch) => {
                            updateBlock(num, b.id, patch);
                          }}
                          onRemove={() => {
                            removeBlock(num, b.id);
                          }}
                          weekdayLabel={label}
                          idx={idx}
                        />
                      );
                    })
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() => {
                        addBlock(num);
                      }}
                      disabled={list.length >= MAX_BLOCKS_PER_DAY}
                      aria-label={`Add a block on ${label}`}
                    >
                      <svg
                        aria-hidden
                        viewBox="0 0 20 20"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                      </svg>
                      Add block
                    </Button>
                    {list.length >= MAX_BLOCKS_PER_DAY ? (
                      <span className="ml-2 text-xs text-[rgb(var(--fg-muted))]">
                        Max {String(MAX_BLOCKS_PER_DAY)} per day
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.82)] px-5 py-3 backdrop-blur">
        <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
          {hasBlockingError
            ? "Fix errors to save"
            : isDirty
            ? "Unsaved changes"
            : "No changes"}
        </p>
        <Button
          type="button"
          onClick={onSave}
          disabled={pending || !isDirty || hasBlockingError}
          className="min-h-11"
        >
          {pending ? "Saving…" : "Save availability"}
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
  const errorBorder =
    errorKind === "overlap" || errorKind === "invalid"
      ? "border-[rgb(var(--fg-danger))]"
      : "border-[rgb(var(--border-subtle))]";
  const errorMsg =
    errorKind === "invalid"
      ? "Start must be before end."
      : errorKind === "overlap"
      ? "Overlaps another block on this day."
      : errorKind === "short"
      ? `Shorter than ${String(MIN_BLOCK_DURATION_MIN)} min — OK but tight.`
      : null;
  const isHardError = errorKind === "invalid" || errorKind === "overlap";
  return (
    <div
      className={[
        "flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5",
        errorBorder,
      ].join(" ")}
    >
      <input
        type="time"
        value={minToHHMM(block.startMin)}
        onChange={(e) => {
          onChange({ startMin: hhmmToMin(e.target.value) });
        }}
        aria-label={`${weekdayLabel} block ${String(idx + 1)} start time`}
        aria-invalid={isHardError}
        // min-h-11 + text-base keep the native time picker tappable +
        // avoid iOS zoom-on-focus (<16px triggers zoom).
        className="min-h-11 w-[7rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 font-mono text-base text-[rgb(var(--fg-primary))]"
      />
      <span className="text-xs text-[rgb(var(--fg-muted))]">—</span>
      <input
        type="time"
        value={minToHHMM(block.endMin)}
        onChange={(e) => {
          onChange({ endMin: hhmmToMin(e.target.value) });
        }}
        aria-label={`${weekdayLabel} block ${String(idx + 1)} end time`}
        aria-invalid={isHardError}
        className="min-h-11 w-[7rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 font-mono text-base text-[rgb(var(--fg-primary))]"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
        onClick={onRemove}
        aria-label={`Remove ${weekdayLabel} block ${String(idx + 1)}`}
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M5 6h10M8 6V4h4v2M7 6l1 10h4l1-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      {errorMsg ? (
        <p
          role={isHardError ? "alert" : undefined}
          className={[
            "basis-full text-xs",
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
