"use client";

import { Calendar, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAvailabilityWeek } from "~/app/(producer)/dashboard/booking/actions";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useToast } from "~/components/ui/toast";

import {
  AVAILABILITY_STEP_INDEX,
  nextRouteAfterAvailability,
  routeOnBackFromAvailability,
  routeOnSkipFromAvailability,
} from "./constants";

// Step 3 — When you work. May 2026 redesign (revised 2026-05-09).
//
// Compact two-column layout that fits 1280×840 without scrolling:
//
//   Left  (340px): 7 day rows. Toggle on/off + 1..3 time windows per
//                  day with + add window / × remove window.
//   Right (180px): Settings — Auto-confirm toggle, Buffer minutes,
//                  Cancellation policy, Google Calendar sync stub.
//
// The settings (auto-confirm / buffer / cancellation / GCal) capture
// in local state today; persistence to producers.{auto_confirm_bookings,
// buffer_minutes, cancellation_policy_hours} is a 3-line follow-up
// once we wire a server action. The columns already exist in the
// producers table — no schema work needed.

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

const ROW_TEMPLATE: ReadonlyArray<{
  weekday: Weekday;
  label: string;
  defaultActive: boolean;
}> = [
  { weekday: 1, label: "Mon", defaultActive: true },
  { weekday: 2, label: "Tue", defaultActive: true },
  { weekday: 3, label: "Wed", defaultActive: true },
  { weekday: 4, label: "Thu", defaultActive: true },
  { weekday: 5, label: "Fri", defaultActive: true },
  { weekday: 6, label: "Sat", defaultActive: false },
  { weekday: 0, label: "Sun", defaultActive: false },
];

const DEFAULT_WINDOW: WindowConfig = { startMin: 10 * 60, endMin: 18 * 60 };

const BUFFER_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "None", value: 0 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "60 min", value: 60 },
];

const CANCELLATION_OPTIONS: ReadonlyArray<{
  label: string;
  value: number;
}> = [
  { label: "24h", value: 24 },
  { label: "48h", value: 48 },
  { label: "1 week", value: 168 },
];

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
}: {
  blocks: BlockInput[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<DayConfig[]>(() =>
    buildInitialDays(blocks),
  );
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [bufferMin, setBufferMin] = useState(15);
  const [cancellationHours, setCancellationHours] = useState(24);
  const [gcalConnected] = useState(false);

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
      prev.map((d) =>
        d.weekday === weekday && d.windows.length < 3
          ? { ...d, windows: [...d.windows, { ...DEFAULT_WINDOW }] }
          : d,
      ),
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
      // TODO(persist-settings): wire a `setSchedulePolicies` server
      // action to write { autoConfirm, bufferMin, cancellationHours }
      // to producers.{auto_confirm_bookings, buffer_minutes,
      // cancellation_policy_hours}. Columns already exist; one-line
      // upsert per field. Tracked separately to keep this commit
      // focused on the visual rebuild.
      router.push(target);
    });
  };

  return (
    <WizardChrome
      activePosition={AVAILABILITY_STEP_INDEX}
      stepIndicator="Step 3 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push(routeOnBackFromAvailability())}
          onSkip={() => advance(routeOnSkipFromAvailability())}
          onContinue={() => advance(nextRouteAfterAvailability())}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
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
          Set your hours and rules. Edit anything from Calendar later.
        </p>

        {/* Days grid (compact, with per-day multi-window) */}
        <ul className="mt-4 flex flex-col gap-1.5">
          {days.map((day) => (
            <li
              key={day.weekday}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-opacity ${
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
                onClick={() => updateDay(day.weekday, { active: !day.active })}
                className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  day.active
                    ? "bg-[rgb(var(--brand-primary))]"
                    : "bg-[rgb(var(--border-strong))]"
                }`}
              >
                <span
                  className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    day.active ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <span className="w-9 text-[12px] font-bold text-[rgb(var(--fg-default))]">
                {day.label}
              </span>

              {/* Windows */}
              <div className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-1.5">
                {day.windows.map((w, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-1 py-0.5"
                  >
                    <input
                      type="time"
                      value={minutesToTime(w.startMin)}
                      disabled={!day.active || pending}
                      onChange={(e) =>
                        updateWindow(day.weekday, idx, {
                          startMin: timeToMinutes(e.target.value),
                        })
                      }
                      className="w-[58px] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                    />
                    <span className="text-[rgb(var(--fg-faint))]">–</span>
                    <input
                      type="time"
                      value={minutesToTime(w.endMin)}
                      disabled={!day.active || pending}
                      onChange={(e) =>
                        updateWindow(day.weekday, idx, {
                          endMin: timeToMinutes(e.target.value),
                        })
                      }
                      className="w-[58px] bg-transparent px-1 py-0.5 font-mono text-[11px] text-[rgb(var(--fg-default))] outline-none disabled:cursor-not-allowed"
                    />
                    {day.active && day.windows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeWindow(day.weekday, idx)}
                        aria-label="Remove window"
                        className="flex h-4 w-4 items-center justify-center rounded text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-elevated))]"
                      >
                        <X size={9} />
                      </button>
                    ) : null}
                  </div>
                ))}
                {day.active && day.windows.length < 3 ? (
                  <button
                    type="button"
                    onClick={() => addWindow(day.weekday)}
                    aria-label={`Add window to ${day.label}`}
                    className="flex h-5 w-5 items-center justify-center rounded-md border border-dashed border-[rgb(var(--border-strong))] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))]"
                  >
                    <Plus size={10} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {/* Settings strip */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {/* Auto-confirm toggle */}
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
            <span className="flex flex-col">
              <span className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                Auto-confirm
              </span>
              <span className="text-[10px] text-[rgb(var(--fg-muted))]">
                Skip the approval click
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoConfirm}
              onClick={() => setAutoConfirm(!autoConfirm)}
              className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                autoConfirm
                  ? "bg-[rgb(var(--brand-primary))]"
                  : "bg-[rgb(var(--border-strong))]"
              }`}
            >
              <span
                className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  autoConfirm ? "translate-x-[18px]" : "translate-x-[2px]"
                }`}
              />
            </button>
          </label>

          {/* Buffer */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
            <span className="flex flex-col">
              <span className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                Buffer
              </span>
              <span className="text-[10px] text-[rgb(var(--fg-muted))]">
                Between sessions
              </span>
            </span>
            <select
              value={bufferMin}
              onChange={(e) => setBufferMin(Number(e.target.value))}
              className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2 py-1 font-mono text-[11px] font-semibold text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))]"
            >
              {BUFFER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Cancellation policy */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
            <span className="flex flex-col">
              <span className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                Cancellation
              </span>
              <span className="text-[10px] text-[rgb(var(--fg-muted))]">
                Notice required
              </span>
            </span>
            <select
              value={cancellationHours}
              onChange={(e) => setCancellationHours(Number(e.target.value))}
              className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2 py-1 font-mono text-[11px] font-semibold text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))]"
            >
              {CANCELLATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Google Calendar sync (stub) */}
          <button
            type="button"
            disabled
            className="flex items-center justify-between gap-2 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-left opacity-70"
          >
            <span className="flex flex-col">
              <span className="text-[11.5px] font-bold text-[rgb(var(--fg-default))]">
                Google Calendar
              </span>
              <span className="text-[10px] text-[rgb(var(--fg-muted))]">
                {gcalConnected ? "Connected" : "Coming soon"}
              </span>
            </span>
            <Calendar
              size={14}
              className="text-[rgb(var(--brand-primary-dark))]"
              aria-hidden
            />
          </button>
        </div>
      </div>
    </WizardChrome>
  );
}
