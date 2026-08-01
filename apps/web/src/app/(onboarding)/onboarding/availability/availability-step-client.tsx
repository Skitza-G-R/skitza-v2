"use client";

import { Copy, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { setAvailabilityWeek } from "~/app/(producer)/dashboard/booking/actions";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { orderByWeekStart, useWeekStartPref, type WeekStart } from "~/lib/time/week-start";

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
  previewMode = false,
}: {
  blocks: BlockInput[];
  // Producer's stored week-start (DB-backed since the Settings redesign).
  // Optional with a sensible default so dev preview mode — which renders
  // without a real producer row — still works.
  initialWeekStart?: WeekStart;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<DayConfig[]>(() => buildInitialDays(blocks));

  // Shared week-start preference — DB-backed, so flipping it here
  // carries over to the Calendar availability tab and the Settings →
  // Language & region segmented control. `days` stays canonically
  // Sun-first; we only rotate the rendered slice.
  const [weekStart, setWeekStart] = useWeekStartPref(
    initialWeekStart,
    (message) => {
      toast(message, "error");
    },
    !previewMode,
  );
  const orderedDays = useMemo(() => orderByWeekStart(days, weekStart), [days, weekStart]);

  const updateDay = (weekday: Weekday, patch: Partial<DayConfig>) => {
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  };

  const updateWindow = (weekday: Weekday, idx: number, patch: Partial<WindowConfig>) => {
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? {
              ...d,
              windows: d.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
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
    const targetCount = days.filter((d) => d.active && d.weekday !== sourceWeekday).length;
    if (targetCount === 0) return;
    const cloneWindows = () => source.windows.map((w) => ({ ...w }));
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === sourceWeekday || !d.active ? d : { ...d, windows: cloneWindows() },
      ),
    );
    toast(
      `Copied ${source.label}'s hours to ${String(targetCount)} other day${targetCount === 1 ? "" : "s"}`,
      "success",
    );
  };

  const activeDayCount = days.filter((d) => d.active).length;
  const activeWindows = days.filter((day) => day.active).flatMap((day) => day.windows);
  const hoursAreValid =
    activeWindows.length > 0 &&
    activeWindows.every(
      (window) =>
        window.startMin >= 0 && window.endMin <= 24 * 60 && window.endMin - window.startMin >= 30,
    );

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

  const previewSuffix = previewMode ? "?__preview=1" : "";

  const saveAndContinue = () => {
    if (!hoursAreValid) {
      toast("Add at least one valid 30-minute working window.", "error");
      return;
    }
    if (previewMode) {
      router.push(`${nextRouteAfterAvailability()}${previewSuffix}`);
      return;
    }
    if (!online) {
      toast("Reconnect to save availability.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const res = await setAvailabilityWeek({ blocks: collectBlocks() });
        if (!res.ok) {
          toast(`Couldn't save availability: ${res.error}`, "error");
          return;
        }
        router.push(nextRouteAfterAvailability());
      } catch {
        toast("Could not save availability. Try again.", "error");
      }
    });
  };

  return (
    <WizardChrome
      activePosition={AVAILABILITY_STEP_INDEX}
      completedCount={3}
      stepIndicator="Working hours"
      canExit={!previewMode}
      previewMode={previewMode}
      footer={
        <WizardFooter
          onBack={() => {
            router.push(`${routeOnBackFromAvailability()}${previewSuffix}`);
          }}
          onSkip={() => {
            router.push(
              previewMode ? "/onboarding/welcome?__preview=1" : routeOnSkipFromAvailability(),
            );
          }}
          onContinue={saveAndContinue}
          continueDisabled={!hoursAreValid}
          pending={pending}
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[10.5px] font-bold tracking-[0.22em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Working hours · Required for this product
        </p>
        <h1
          className="font-display mt-2 text-[26px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          When should artists be able to book you?
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
          Set your working hours. You approve every booking request.
        </p>

        {blocks.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3">
            <p className="text-[12px] font-bold text-[rgb(var(--fg-default))]">Suggested hours</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Monday to Friday, 10:00–18:00. These are not saved until you continue.
            </p>
          </div>
        ) : null}

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
          <div
            role="group"
            aria-label="Week starts on"
            className="grid shrink-0 grid-cols-2 gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-1"
          >
            {(["sunday", "monday"] as const).map((opt) => {
              const isActive = opt === weekStart;
              const label = opt === "sunday" ? "Sunday" : "Monday";
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setWeekStart(opt);
                  }}
                  className={[
                    "inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border px-2.5 font-mono text-[10.5px] transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:transition-none",
                    isActive
                      ? "border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
                      : "border-transparent bg-transparent text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Weekly schedule. Each day is one readable control group:
            state first, hours second, row actions last. On phones the
            hours move below the day without changing their order. */}
        <ul aria-label="Weekly working hours" className="mt-3 flex flex-col gap-2">
          {orderedDays.map((day) => (
            <li
              key={day.weekday}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-[var(--radius-lg)] border p-2 transition-[border-color,background-color] motion-reduce:transition-none sm:grid-cols-[140px_minmax(0,1fr)_auto] ${
                day.active
                  ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
                  : "border-[rgb(var(--border-subtle)/0.72)] bg-[rgb(var(--bg-background)/0.46)]"
              }`}
            >
              {/* The whole labeled block is the switch. This avoids a
                  tiny color-only toggle floating beside an abbreviation. */}
              <button
                type="button"
                role="switch"
                aria-checked={day.active}
                aria-label={`${WEEKDAY_NAMES[day.weekday]} availability`}
                onClick={() => {
                  updateDay(day.weekday, { active: !day.active });
                }}
                className={`group col-start-1 row-start-1 flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-lg)] border px-2.5 py-1.5 text-left transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none ${
                  day.active
                    ? "border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.09)]"
                    : "border-transparent bg-transparent hover:border-[rgb(var(--border-subtle))] hover:bg-[rgb(var(--bg-elevated))]"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full transition-[background-color,box-shadow] motion-reduce:transition-none ${
                    day.active
                      ? "bg-[rgb(var(--brand-primary))] shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.14)]"
                      : "bg-[rgb(var(--fg-faint))] shadow-[0_0_0_4px_rgb(var(--border-subtle)/0.76)]"
                  }`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                    {WEEKDAY_NAMES[day.weekday]}
                  </span>
                  <span
                    className={`mt-0.5 font-mono text-[9.5px] leading-tight tracking-[0.08em] uppercase ${
                      day.active
                        ? "text-[rgb(var(--brand-primary-dark))]"
                        : "text-[rgb(var(--fg-muted))]"
                    }`}
                  >
                    {day.active ? "Available" : "Day off"}
                  </span>
                </span>
              </button>

              {/* Windows occupy the middle column on desktop and a
                  full second row on narrow screens. */}
              {day.active ? (
                <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {day.windows.map((w, idx) => (
                    <div
                      key={idx}
                      className={`grid min-h-11 min-w-0 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2 focus-within:border-[rgb(var(--brand-primary)/0.6)] focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.12)] ${
                        day.windows.length > 1
                          ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_44px]"
                          : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
                      }`}
                    >
                      <label className="min-w-0">
                        <span className="sr-only">
                          {WEEKDAY_NAMES[day.weekday]}{" "}
                          {day.windows.length > 1 ? `window ${String(idx + 1)} ` : ""}
                          start time
                        </span>
                        <input
                          type="time"
                          value={minutesToTime(w.startMin)}
                          disabled={pending}
                          onChange={(e) => {
                            updateWindow(day.weekday, idx, {
                              startMin: timeToMinutes(e.target.value),
                            });
                          }}
                          className="time-input-naked h-11 w-full min-w-0 bg-transparent px-1 font-mono text-[11px] font-semibold text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                        />
                      </label>
                      <span className="font-mono text-[9px] tracking-[0.08em] text-[rgb(var(--fg-faint))] uppercase">
                        to
                      </span>
                      <label className="min-w-0">
                        <span className="sr-only">
                          {WEEKDAY_NAMES[day.weekday]}{" "}
                          {day.windows.length > 1 ? `window ${String(idx + 1)} ` : ""}
                          end time
                        </span>
                        <input
                          type="time"
                          value={minutesToTime(w.endMin)}
                          disabled={pending}
                          onChange={(e) => {
                            updateWindow(day.weekday, idx, {
                              endMin: timeToMinutes(e.target.value),
                            });
                          }}
                          className="time-input-naked h-11 w-full min-w-0 bg-transparent px-1 font-mono text-[11px] font-semibold text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                        />
                      </label>
                      {day.windows.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            removeWindow(day.weekday, idx);
                          }}
                          aria-label={`Remove ${WEEKDAY_NAMES[day.weekday]} window ${String(idx + 1)}`}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:transition-none"
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Row actions stay together at the right edge. On mobile
                  they share the first row with the day control. */}
              {day.active ? (
                <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 sm:col-start-3">
                  {activeDayCount > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        copyToAllDays(day.weekday);
                      }}
                      aria-label={`Copy ${day.label}'s hours to all days`}
                      title="Copy to all days"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:transition-none"
                    >
                      <Copy size={12} />
                    </button>
                  ) : null}
                  {day.windows.length < 3 ? (
                    <button
                      type="button"
                      onClick={() => {
                        addWindow(day.weekday);
                      }}
                      aria-label={`Add window to ${day.label}`}
                      title="Add another time window"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none motion-reduce:transition-none"
                    >
                      <Plus size={12} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </WizardChrome>
  );
}
