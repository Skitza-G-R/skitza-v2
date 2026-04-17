"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { setAvailabilityWeek } from "./actions";

// One row per (weekday, block kind). Two blocks per day max: morning
// and evening. Producer can enable/disable each block and tune times.
// Times stored as minutes-from-day-start; UI renders `HH:MM`.

type BlockKind = "morning" | "evening";

interface DraftBlock {
  enabled: boolean;
  startMin: number;
  endMin: number;
}

// Keys are stringified-weekday + kind. Typed as `${string}-${kind}`
// (not `${number}-`) so template-literal expansion with String(num)
// type-checks under the strict template-expressions rule.
type DraftKey = `${string}-${BlockKind}`;
// Lookup helper with non-null assertion — the Draft is always fully
// populated after buildDraft() initializes every (weekday, kind) pair,
// so indexed access cannot return undefined at runtime.
type Draft = Record<DraftKey, DraftBlock>;
function pick(d: Draft, k: DraftKey): DraftBlock {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return d[k]!;
}

const WEEKDAYS = [
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
  { num: 0, label: "Sun" },
] as const;

// Sensible defaults — producer can tweak after saving.
const DEFAULT_MORNING = { startMin: 10 * 60, endMin: 13 * 60 }; // 10:00-13:00
const DEFAULT_EVENING = { startMin: 19 * 60, endMin: 22 * 60 }; // 19:00-22:00

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMin(v: string): number {
  const [h = "0", m = "0"] = v.split(":");
  return Number(h) * 60 + Number(m);
}

function buildDraft(
  blocks: readonly { weekday: number; startMin: number; endMin: number }[],
): Draft {
  const out: Draft = {} as Draft;
  for (const { num } of WEEKDAYS) {
    const weekdayBlocks = blocks
      .filter((b) => b.weekday === num)
      .sort((a, b) => a.startMin - b.startMin);
    // Morning = first block of the day; evening = second.
    const morning = weekdayBlocks[0];
    const evening = weekdayBlocks[1];
    out[`${String(num)}-morning` as const] = morning
      ? { enabled: true, startMin: morning.startMin, endMin: morning.endMin }
      : { enabled: false, ...DEFAULT_MORNING };
    out[`${String(num)}-evening` as const] = evening
      ? { enabled: true, startMin: evening.startMin, endMin: evening.endMin }
      : { enabled: false, ...DEFAULT_EVENING };
  }
  return out;
}

export function AvailabilityEditor({
  initialBlocks,
}: {
  initialBlocks: { weekday: number; startMin: number; endMin: number }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => buildDraft(initialBlocks));

  const isDirty = useMemo(() => {
    const rebuilt = buildDraft(initialBlocks);
    return JSON.stringify(draft) !== JSON.stringify(rebuilt);
  }, [draft, initialBlocks]);

  function update(key: DraftKey, patch: Partial<DraftBlock>) {
    setDraft((d) => ({ ...d, [key]: { ...pick(d, key), ...patch } }));
  }

  function onSave() {
    // Serialize: only enabled blocks, only where start<end.
    const blocks: { weekday: number; startMin: number; endMin: number }[] = [];
    for (const { num } of WEEKDAYS) {
      for (const kind of ["morning", "evening"] as const) {
        const b = pick(draft, `${String(num)}-${kind}`);
        if (!b.enabled) continue;
        if (b.startMin >= b.endMin) {
          toast(`Invalid time on ${WEEKDAYS.find((w) => w.num === num)?.label ?? ""}: start must be before end.`, "error");
          return;
        }
        blocks.push({ weekday: num, startMin: b.startMin, endMin: b.endMin });
      }
    }
    startTransition(async () => {
      const res = await setAvailabilityWeek({ blocks });
      if (res.ok) {
        toast("Availability saved.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <div className="grid grid-cols-[minmax(0,_4rem)_auto_auto] items-center gap-4 pb-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          <div>Day</div>
          <div>Morning</div>
          <div>Evening</div>
        </div>
        <div className="divide-y divide-[rgb(var(--border-subtle))]">
          {WEEKDAYS.map(({ num, label }) => (
            <div
              key={num}
              className="grid grid-cols-[minmax(0,_4rem)_auto_auto] items-center gap-4 py-3"
            >
              <div className="font-mono text-sm text-[rgb(var(--fg-primary))]">{label}</div>
              <BlockRow
                block={pick(draft, `${String(num)}-morning`)}
                onChange={(patch) => {
                  update(`${String(num)}-morning`, patch);
                }}
              />
              <BlockRow
                block={pick(draft, `${String(num)}-evening`)}
                onChange={(patch) => {
                  update(`${String(num)}-evening`, patch);
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.82)] px-5 py-3 backdrop-blur">
        <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
          {isDirty ? "Unsaved changes" : "No changes"}
        </p>
        <Button type="button" onClick={onSave} disabled={pending || !isDirty}>
          {pending ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </div>
  );
}

function BlockRow({
  block,
  onChange,
}: {
  block: DraftBlock;
  onChange: (patch: Partial<DraftBlock>) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={block.enabled}
          onChange={(e) => {
            onChange({ enabled: e.target.checked });
          }}
          className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
        />
      </label>
      <input
        type="time"
        value={minToHHMM(block.startMin)}
        onChange={(e) => {
          onChange({ startMin: hhmmToMin(e.target.value) });
        }}
        disabled={!block.enabled}
        className="w-[6.25rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 font-mono text-xs text-[rgb(var(--fg-primary))] disabled:opacity-40"
      />
      <span className="text-xs text-[rgb(var(--fg-muted))]">—</span>
      <input
        type="time"
        value={minToHHMM(block.endMin)}
        onChange={(e) => {
          onChange({ endMin: hhmmToMin(e.target.value) });
        }}
        disabled={!block.enabled}
        className="w-[6.25rem] rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 font-mono text-xs text-[rgb(var(--fg-primary))] disabled:opacity-40"
      />
    </div>
  );
}
