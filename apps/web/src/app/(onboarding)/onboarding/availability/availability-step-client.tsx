"use client";

import { Copy, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { setAvailabilityWeek } from "~/app/(producer)/dashboard/booking/actions";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useToast } from "~/components/ui/toast";
import {
  orderByWeekStart,
  useWeekStartPref,
  type WeekStart,
} from "~/lib/time/week-start";

import {
  AVAILABILITY_STEP_INDEX,
  nextRouteAfterAvailability,
  routeOnBackFromAvailability,
  routeOnSkipFromAvailability,
} from "./constants";

// Step 3 — When you work. May 2026 redesign (revised 2026-05-09).
//
// Seven day rows let the producer toggle days and edit up to three
// working windows per day. Continue persists only these working hours,
// so this step intentionally does not show unrelated policy controls.

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface WindowConfig {
  startMin: number;
  endMin: number;
}

interface DayConfig {
  weekday: Weekday;
  label: string;
  active: boolean;
  windows: WindowConfig[];
}

// Canonical Sunday-first ordering — matches JavaScript's getDay()
// convention (0=Sun..6=Sat). The visible order in the rendered grid
// is computed via orderByWeekStart() so producers who prefer
// Monday-first see the row list rotated without changing the state shape.
const ROW_TEMPLATE: ReadonlyArray<{
  weekday: Weekday;
  label: string;
  defaultActive: boolean;
}> = [
  { weekday: 0, label: "Sun", defaultActive: false },
  { weekday: 1, label: "Mon", defaultActive: true },
  { weekday: 2, label: "Tue", defaultActive: true },
  { weekday: 3, label: "Wed", defaultActive: true },
  { weekday: 4, label: "Thu", defaultActive: true },
  { weekday: 5, label: "Fri", defaultActive: true },
  { weekday: 6, label: "Sat", defaultActive: false },
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DEFAULT_WINDOW: WindowConfig = { startMin: 10 * 60, endMin: 18 * 60 };

interface BlockInput {
  weekday: number;
  startMin: number;
  endMin: number;
}

function timeToMinutes(value: string): number {
  const [h = "0", m = "0"] = value.split(":");
  const hours = Number.parseInt(h, 10);
  const mins = Number.parseInt(m, 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return 0;
  return hours * 60 + mins;
}

function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.floor(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildInitialDays(blocks: ReadonlyArray<BlockInput>): DayConfig[] {
  const byWeekday = new Map<number, BlockInput[]>();
  for (const b of blocks) {
    const existing = byWeekday.get(b.weekday) ?? [];
    existing.push(b);
    byWeekday.set(b.weekday, existing);
  }
  return ROW_TEMPLATE.map((row) => {
    const stored = byWeekday.get(row.weekday);
    if (stored && stored.length > 0) {
      return {
        weekday: row.weekday,
        label: row.label,
        active: true,
        windows: stored.map((b) => ({
          startMin: b.startMin,
          endMin: b.endMin,
        })),
      };
    }
    return {
      weekday: row.weekday,
      label: row.label,
      active: row.defaultActive,
      windows: [{ ...DEFAULT_WINDOW }],
    };
  });
}

export function AvailabilityStepClient({
  blocks,
  initialWeekStart = "sunday",
}: {
  blocks: BlockInput[];
  // Producer's stored week-start (DB-backed since the Settings redesign).
  // Optional with a sensible default so dev preview mode — which renders
  // without a real producer row — still works.
  initialWeekStart?: WeekStart;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<DayConfig[]>(() =>
    buildInitialDays(blocks),
  );

  // Shared week-start preference — DB-backed, so flipping it here
  // carries over to the Calendar availability tab and the Settings →
  // Language & region segmented control. `days` stays canonically
  // Sun-first; we only rotate the rendered slice.
  const [weekStart, setWeekStart] = useWeekStartPref(
    initialWeekStart,
    (message) => {
      toast(message, "error");
    },
  );
  const orderedDays = useMemo(
    () => orderByWeekStart(days, weekStart),
    [days, weekStart],
  );

  const updateDay = (weekday: Weekday, patch: Partial<DayConfig>) => {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  };

  const updateWindow = (
    weekday: Weekday,
    idx: number,
    patch: Partial<WindowConfig>,
  ) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? {
              ...d,
              windows: d.windows.map((w, i) =>
                i === idx ? { ...w, ...patch } : w,
              ),
            }
          : d,
      ),
    );
  };

  const addWindow = (weekday: Weekday) => {
    setDays((prev) =>
      prev.map((d) => {
        if (d.weekday !== weekday || d.windows.length >= 3) return d;
        const last = d.windows[d.windows.length - 1];
        const lastEnd = last?.endMin ?? DEFAULT_WINDOW.endMin;
        const DAY_END = 24 * 60;
        // New window picks up where the previous one ended, defaulting
        // to a 2-hour evening slot, capped at midnight.
        let startMin = Math.min(lastEnd, DAY_END);
        let endMin = Math.min(startMin + 2 * 60, DAY_END);
        if (endMin - startMin < 30) {
          // No usable room left in the day — fall back to the last hour
          // so the inputs render with sane, editable values.
          endMin = DAY_END;
          startMin = DAY_END - 60;
        }
        return { ...d, windows: [...d.windows, { startMin, endMin }] };
      }),
    );
  };

  const removeWindow = (weekday: Weekday, idx: number) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday && d.windows.length > 1
          ? { ...d, windows: d.windows.filter((_, i) => i !== idx) }
          : d,
      ),
    );
  };

  const copyToAllDays = (sourceWeekday: Weekday) => {
    const source = days.find((d) => d.weekday === sourceWeekday);
    if (!source || !source.active) return;
    const targetCount = days.filter(
      (d) => d.active && d.weekday !== sourceWeekday,
    ).length;
    if (targetCount === 0) return;
    const cloneWindows = () => source.windows.map((w) => ({ ...w }));
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === sourceWeekday || !d.active
          ? d
          : { ...d, windows: cloneWindows() },
      ),
    );
    toast(
      `Copied ${source.label}'s hours to ${String(targetCount)} other day${targetCount === 1 ? "" : "s"}`,
      "success",
    );
  };

  const activeDayCount = days.filter((d) => d.active).length;

  const collectBlocks = (): BlockInput[] =>
    days
      .filter((d) => d.active)
      .flatMap((d) =>
        d.windows
          .filter((w) => w.endMin > w.startMin)
          .map((w) => ({
            weekday: d.weekday,
            startMin: w.startMin,
            endMin: w.endMin,
          })),
      );

  const advance = (target: string) => {
    startTransition(async () => {
      const res = await setAvailabilityWeek({ blocks: collectBlocks() });
      if (!res.ok) {
        toast(`Couldn't save availability: ${res.error}`, "error");
        return;
      }
      router.push(target);
    });
  };

  return (
    <WizardChrome
      activePosition={AVAILABILITY_STEP_INDEX}
      stepIndicator="Step 3 of 5"
      footer={
        <WizardFooter
          onBack={() => { router.push(routeOnBackFromAvailability()); }}
          onSkip={() => { advance(routeOnSkipFromAvailability()); }}
          onContinue={() => { advance(nextRouteAfterAvailability()); }}
          pending={pending}
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 3 of 5 · Required
        </p>
        <h1
          className="mt-2 font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          When you work.
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
          Set your working hours. Edit them from Calendar later.
        </p>

        {/* Week-start preference — shared with the Calendar page via
            localStorage. Producers who think in Mon-first weeks can
            flip it once here and the dashboard remembers. */}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
          <span className="flex flex-col">
            <span className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
              Week starts on
            </span>
            <span className="text-[10px] text-[rgb(var(--fg-muted))]">
              Used by the calendar week grid.
            </span>
          </span>
          <div className="flex shrink-0 gap-1">
            {(["sunday", "monday"] as const).map((opt) => {
              const isActive = opt === weekStart;
              const label = opt === "sunday" ? "Sunday" : "Monday";
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => { setWeekStart(opt); }}
                  className={[
                    "inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border px-2.5 font-mono text-[10.5px] transition-colors motion-reduce:transition-none",
                    isActive
                      ? "border-transparent bg-[rgb(var(--fg-default))] text-[rgb(var(--fg-inverse))]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Days grid (compact, with per-day multi-window) */}
        <ul className="mt-3 flex flex-col gap-1.5">
          {orderedDays.map((day) => (
            <li
              key={day.weekday}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-opacity motion-reduce:transition-none ${
                day.active
                  ? "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] opacity-100"
                  : "border border-transparent opacity-50"
              }`}
            >
              {/* Day toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={day.active}
                aria-label={`${WEEKDAY_NAMES[day.weekday]} availability`}
                onClick={() => { updateDay(day.weekday, { active: !day.active }); }}
                className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full"
              >
                <span
                  aria-hidden
                  className={`relative h-5 w-9 rounded-full transition-colors motion-reduce:transition-none ${
                    day.active
                      ? "bg-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--border-strong))]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                      day.active ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </span>
              </button>
              <span className="w-9 text-[12px] font-bold text-[rgb(var(--fg-default))]">
                {day.label}
              </span>

              {/* Copy lives left-of-windows on purpose: dropping it
                  into the windows row let it wrap to a second line as
                  soon as a 2nd window appeared, so the bracket grew.
                  Anchoring Copy to the day-label cluster keeps the
                  row a constant height and reads as "this day's
                  action" — same convention as the toggle. */}
              {day.active && activeDayCount > 1 ? (
                <button
                  type="button"
                  onClick={() => { copyToAllDays(day.weekday); }}
                  aria-label={`Copy ${day.label}'s hours to all days`}
                  title="Copy to all days"
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))] motion-reduce:transition-none"
                >
                  <Copy size={11} />
                </button>
              ) : null}

              {/* Windows — hidden when day is off (cleaner than dimmed
                  text that still suggests data). */}
              {day.active ? (
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {day.windows.map((w, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-1 py-0.5"
                    >
                      <input
                        type="time"
                        value={minutesToTime(w.startMin)}
                        disabled={pending}
                        onChange={(e) =>
                          { updateWindow(day.weekday, idx, {
                            startMin: timeToMinutes(e.target.value),
                          }); }
                        }
                        className="time-input-naked h-11 w-[64px] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                      />
                      <span className="text-[rgb(var(--fg-faint))]">–</span>
                      <input
                        type="time"
                        value={minutesToTime(w.endMin)}
                        disabled={pending}
                        onChange={(e) =>
                          { updateWindow(day.weekday, idx, {
                            endMin: timeToMinutes(e.target.value),
                          }); }
                        }
                        className="time-input-naked h-11 w-[64px] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                      />
                      {day.windows.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => { removeWindow(day.weekday, idx); }}
                          aria-label="Remove window"
                          className="flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))]"
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {day.windows.length < 3 ? (
                    <button
                      type="button"
                      onClick={() => { addWindow(day.weekday); }}
                      aria-label={`Add window to ${day.label}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-[rgb(var(--border-strong))] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))]"
                    >
                      <Plus size={12} />
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="ml-auto pr-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[rgb(var(--fg-faint))]">
                  Off
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </WizardChrome>
  );
}
