"use client";

// Producer Calendar — Availability tab per spec § 6.
//
// Two-column layout (lg+):
//   ┌─ Working hours card (left, 1fr) ───────┬─ Booking prefs ──────┐
//   │ Mini-chart (7 bars)                    │ Auto-confirm         │
//   │ Day rows (toggle | name | windows | h) │ Cancellation window  │
//   │ Save changes                           │ Timezone             │
//   ├────────────────────────────────────────┤                      │
//   │                                        ├──────────────────────┤
//   │                                        │ Blocked dates        │
//   └────────────────────────────────────────┴──────────────────────┘
//
// Working hours uses the same tRPC `availability.setWeek` proc as the
// existing /booking page editor — same data, new visual treatment.
// Booking prefs uses `availability.updateSettings`. Blackouts use
// `blackouts.create` / `blackouts.remove`.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import {
  orderByWeekStart,
  useWeekStartPref,
  type WeekStart,
} from "~/lib/time/week-start";
import { runOptimisticPreferenceSave } from "~/lib/optimistic-preference-save";

import {
  addBlackout,
  removeBlackout,
  setAvailabilityWeek,
  updateAvailabilitySettings,
} from "./calendar-actions";

// ── Types & constants ────────────────────────────────────────────────

type Block = { weekday: number; startMin: number; endMin: number };
type Blackout = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

const DAYS = [
  { num: 0, full: "Sunday", short: "S" },
  { num: 1, full: "Monday", short: "M" },
  { num: 2, full: "Tuesday", short: "T" },
  { num: 3, full: "Wednesday", short: "W" },
  { num: 4, full: "Thursday", short: "T" },
  { num: 5, full: "Friday", short: "F" },
  { num: 6, full: "Saturday", short: "S" },
] as const;

type DayInfo = (typeof DAYS)[number];

const CANCEL_HOURS = [12, 24, 48, 72] as const;

// ── Public API ──────────────────────────────────────────────────────

export type AvailabilityPanelProps = {
  blocks: readonly Block[];
  blackouts: readonly Blackout[];
  settings: {
    autoConfirmBookings: boolean;
    cancellationPolicyHours: number;
  };
  // Producer's stored week-start preference (DB-backed since the
  // Settings redesign). The toggle here persists to the same column,
  // so editing in one place updates the other on next visit.
  initialWeekStart: WeekStart;
  timeZone: string;
  initialNow: string;
};

export function AvailabilityPanel({
  blocks: initialBlocks,
  blackouts: initialBlackouts,
  settings,
  initialWeekStart,
  timeZone,
  initialNow,
}: AvailabilityPanelProps) {
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [weekStart, setWeekStart, weekStartSaving] = useWeekStartPref(
    initialWeekStart,
    (message) => {
      toast(message, "error");
    },
  );
  const orderedDays = useMemo(
    () => orderByWeekStart(DAYS, weekStart),
    [weekStart],
  );

  return (
    // Two columns share the viewport-locked panel; each scrolls
    // independently if its content overflows so the page chrome stays
    // anchored.
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col overflow-y-auto">
        <WorkingHoursCard blocks={initialBlocks} orderedDays={orderedDays} online={online} />
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <BookingPrefsCard
          autoConfirm={settings.autoConfirmBookings}
          cancelHours={settings.cancellationPolicyHours}
          weekStart={weekStart}
          onWeekStartChange={(next) => {
            if (!online) {
              toast("Reconnect to update availability.", "error");
              return;
            }
            setWeekStart(next);
          }}
          weekStartSaving={weekStartSaving}
          online={online}
          timeZone={timeZone}
          initialNow={initialNow}
        />
        <BlockedDatesCard blackouts={initialBlackouts} online={online} />
      </div>
    </div>
  );
}

// ── Working hours card ──────────────────────────────────────────────

function WorkingHoursCard({
  blocks,
  orderedDays,
  online,
}: {
  blocks: readonly Block[];
  orderedDays: readonly DayInfo[];
  online: boolean;
}) {
  // Local draft keyed by weekday number; each day has 0+ windows.
  const [draft, setDraft] = useState(() => buildDraft(blocks));
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  // Re-hydrate when the server prop changes (after a save → revalidate).
  useEffect(() => {
    setDraft(buildDraft(blocks));
  }, [blocks]);

  const totals = useMemo(() => computeTotals(draft), [draft]);
  const dirty = !sameBlocks(serialiseDraft(draft), [...blocks]);

  function handleSave() {
    if (!online) {
      toast("Reconnect to save working hours.", "error");
      return;
    }
    const serialised = serialiseDraft(draft);
    startTransition(async () => {
      try {
        const res = await setAvailabilityWeek({ blocks: serialised });
        if (res.ok) {
          toast("Weekly hours saved.", "success");
        } else {
          toast(res.error, "error");
        }
      } catch {
        toast("Could not save working hours. Please try again.", "error");
      }
    });
  }

  function copyMonToWeekdays() {
    const monday = draft[1] ?? [];
    setDraft((prev) => ({
      ...prev,
      2: cloneWindows(monday),
      3: cloneWindows(monday),
      4: cloneWindows(monday),
      5: cloneWindows(monday),
    }));
  }

  return (
    <section
      aria-labelledby="working-hours-heading"
      data-role-switch-unsaved={dirty ? "true" : undefined}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-5 py-4">
        <h2
          id="working-hours-heading"
          className="font-display text-[15px] tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Working hours
        </h2>
        <button
          type="button"
          onClick={copyMonToWeekdays}
          className="sk-press -m-2 p-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] transition-opacity hover:opacity-70"
          style={{ fontWeight: 700 }}
        >
          Copy Mon to weekdays
        </button>
      </header>

      <div className="px-5 pt-4">
        <MiniChart totals={totals} days={orderedDays} />
      </div>

      <ol className="px-5">
        {orderedDays.map((d, idx) => (
          <DayRow
            key={d.num}
            dayNum={d.num}
            dayLabel={d.full}
            windows={draft[d.num] ?? []}
            isLast={idx === orderedDays.length - 1}
            totalH={totals[d.num] ?? 0}
            onToggle={(on) => {
              setDraft((prev) => {
                const existing = prev[d.num] ?? [];
                const next: DraftWindow[] = on
                  ? existing.length > 0
                    ? existing
                    : [{ id: makeId(), startMin: 9 * 60, endMin: 17 * 60 }]
                  : [];
                return { ...prev, [d.num]: next };
              });
            }}
            onAddWindow={() => {
              setDraft((prev) => {
                const existing = prev[d.num] ?? [];
                const last = existing[existing.length - 1];
                const lastEnd = last?.endMin ?? 17 * 60;
                const DAY_END = 24 * 60;
                // New window picks up where the previous one ended,
                // defaulting to a 2-hour evening slot, capped at midnight.
                let startMin = Math.min(lastEnd, DAY_END);
                let endMin = Math.min(startMin + 2 * 60, DAY_END);
                if (endMin - startMin < 30) {
                  // Day is full — fall back to the last hour so the
                  // selects render with sane, editable values.
                  endMin = DAY_END;
                  startMin = DAY_END - 60;
                }
                return {
                  ...prev,
                  [d.num]: [...existing, { id: makeId(), startMin, endMin }],
                };
              });
            }}
            onRemoveWindow={(id) => {
              setDraft((prev) => ({
                ...prev,
                [d.num]: (prev[d.num] ?? []).filter((w) => w.id !== id),
              }));
            }}
            onChangeWindow={(id, patch) => {
              setDraft((prev) => ({
                ...prev,
                [d.num]: (prev[d.num] ?? []).map((w) =>
                  w.id === id ? { ...w, ...patch } : w,
                ),
              }));
            }}
          />
        ))}
      </ol>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--border-subtle))] px-5 py-4">
        <p className="font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          {formatHours(sumHours(totals))}h open per week
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isPending || !online}
          className="sk-press inline-flex h-11 items-center justify-center rounded-[10px] bg-[rgb(var(--fg-default))] px-4 text-[12.5px] text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50 lg:h-9"
          style={{ fontWeight: 700 }}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </section>
  );
}

function MiniChart({
  totals,
  days,
}: {
  totals: Record<number, number>;
  days: readonly DayInfo[];
}) {
  const max = 12; // 12h cap for the bar height; covers most schedules.
  return (
    <div className="rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay)/0.4)] px-3 py-3">
      <div className="flex h-[64px] items-end justify-between gap-1.5 px-2">
        {days.map((d) => {
          const hours = totals[d.num] ?? 0;
          const isOn = hours > 0;
          const heightPct = Math.max(8, Math.min(100, (hours / max) * 100));
          return (
            <div key={d.num} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                aria-hidden
                className="w-full max-w-[22px] rounded-t-[4px] transition-[height] duration-220 motion-reduce:transition-none"
                style={{
                  height: isOn ? `${String(heightPct)}%` : "4px",
                  background: isOn
                    ? "linear-gradient(180deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))"
                    : "rgb(var(--border-subtle))",
                  opacity: isOn ? 1 : 0.6,
                  minHeight: 4,
                }}
              />
              <span
                className="font-mono text-[9.5px] text-[rgb(var(--fg-muted))]"
                style={{ fontWeight: 700 }}
              >
                {d.short}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayRow({
  dayNum,
  dayLabel,
  windows,
  isLast,
  totalH,
  onToggle,
  onAddWindow,
  onRemoveWindow,
  onChangeWindow,
}: {
  dayNum: number;
  dayLabel: string;
  windows: readonly DraftWindow[];
  isLast: boolean;
  totalH: number;
  onToggle: (on: boolean) => void;
  onAddWindow: () => void;
  onRemoveWindow: (id: string) => void;
  onChangeWindow: (id: string, patch: Partial<DraftWindow>) => void;
}) {
  void dayNum;
  const isOn = windows.length > 0;
  return (
    // <lg: two-row layout — toggle | day | hours on top, the time
    // windows on a full-width second row so the selects aren't crushed
    // on a 390px screen. lg+: the spec's single-row 4-column grid.
    <li
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 py-3 lg:grid-cols-[44px_100px_minmax(0,1fr)_auto]"
      style={{
        borderBottom: isLast ? "none" : "1px solid rgb(var(--border-subtle))",
      }}
    >
      <PillToggle label={`${dayLabel} availability`} on={isOn} onChange={onToggle} />
      <span
        className="text-[13.5px] text-[rgb(var(--fg-default))]"
        style={{ fontWeight: 700 }}
      >
        {dayLabel}
      </span>
      {/* SK-56: phones stack each time window on its own line (the
          Calendly/Cal.com pattern) — two selects + an X wrapping
          mid-row read as clutter at 390px. lg+ keeps the spec's
          inline wrap. */}
      <div className="col-span-3 row-start-2 flex flex-col items-stretch gap-2 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:flex-row lg:flex-wrap lg:items-center">
        {isOn ? (
          <>
            {windows.map((w, i) => (
              <span key={w.id} className="flex items-center gap-1.5">
                {i > 0 ? (
                  <span aria-hidden className="hidden h-4 w-px bg-[rgb(var(--border-subtle))] lg:block" />
                ) : null}
                <TimeSelect
                  value={minToHHMM(w.startMin)}
                  onChange={(v) => {
                    onChangeWindow(w.id, { startMin: hhmmToMin(v) });
                  }}
                />
                <span className="text-[12px] text-[rgb(var(--fg-faint))]">—</span>
                <TimeSelect
                  value={minToHHMM(w.endMin)}
                  onChange={(v) => {
                    onChangeWindow(w.id, { endMin: hhmmToMin(v) });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    onRemoveWindow(w.id);
                  }}
                  aria-label="Remove window"
                  className="sk-press ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-faint))] hover:text-[rgb(var(--fg-default))] lg:ml-0 lg:h-6 lg:w-6"
                >
                  <XMini />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={onAddWindow}
              className="sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--brand-primary)/0.5)] bg-transparent px-2.5 text-[10.5px] text-[rgb(var(--brand-primary-dark))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.06)] lg:h-6"
              style={{ fontWeight: 700 }}
            >
              + Add window
            </button>
          </>
        ) : (
          <span className="text-[12.5px] italic text-[rgb(var(--fg-faint))]">Closed</span>
        )}
      </div>
      <span className="col-start-3 row-start-1 font-mono text-[11px] text-[rgb(var(--fg-muted))] lg:col-start-4">
        {isOn ? `${formatHours(totalH)}h` : "—"}
      </span>
    </li>
  );
}

function PillToggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!on);
      }}
      className="sk-press relative inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full disabled:cursor-wait disabled:opacity-60 lg:h-7 lg:w-9"
    >
      <span
        aria-hidden
        className={[
          "relative inline-flex h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          on
            ? "bg-[rgb(var(--brand-primary))]"
            : "bg-[rgb(var(--border-strong))]",
        ].join(" ")}
      >
        <span
          className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200 motion-reduce:transition-none"
          style={{ left: on ? 16 : 2 }}
        />
      </span>
    </button>
  );
}

function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const slots = useMemo(buildSlots, []);
  return (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="h-11 appearance-none rounded-[7px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 font-mono text-[12.5px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none lg:h-7"
      style={{ fontWeight: 600 }}
    >
      {slots.map((slot) => (
        <option key={slot} value={slot}>
          {slot}
        </option>
      ))}
    </select>
  );
}

// ── Booking prefs card ──────────────────────────────────────────────

function BookingPrefsCard({
  autoConfirm,
  cancelHours,
  weekStart,
  onWeekStartChange,
  weekStartSaving,
  online,
  timeZone,
  initialNow,
}: {
  autoConfirm: boolean;
  cancelHours: number;
  weekStart: WeekStart;
  onWeekStartChange: (next: WeekStart) => void;
  weekStartSaving: boolean;
  online: boolean;
  timeZone: string;
  initialNow: string;
}) {
  const [draftAuto, setDraftAuto] = useState(autoConfirm);
  const [draftCancel, setDraftCancel] = useState(cancelHours);
  const [isSaving, setIsSaving] = useState(false);
  const saveLock = useRef({ current: false });
  const { toast } = useToast();

  // Apply immediately, but keep the previous value until the server
  // confirms the write. One lock prevents rapid clicks from racing
  // contradictory preference patches.
  function persist({
    patch,
    apply,
    rollback,
    errorLabel,
  }: {
    patch: {
      autoConfirmBookings?: boolean;
      cancellationPolicyHours?: number;
    };
    apply: () => void;
    rollback: () => void;
    errorLabel: string;
  }) {
    if (saveLock.current.current) return;
    if (!online) {
      toast("Reconnect to update booking preferences.", "error");
      return;
    }
    apply();
    void runOptimisticPreferenceSave({
      lock: saveLock.current,
      save: () => updateAvailabilitySettings(patch),
      rollback,
      onError: (message) => {
        toast(message, "error");
      },
      setPending: setIsSaving,
      errorLabel,
    });
  }

  return (
    <section
      aria-labelledby="booking-prefs-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <h2
          id="booking-prefs-heading"
          className="font-display text-[13px] tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Booking preferences
        </h2>
      </header>

      <div className="space-y-4 p-4">
        {/* Auto-confirm tile */}
        <div
          className={[
            "flex items-center justify-between rounded-[10px] border p-3 transition-colors",
            draftAuto
              ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
          ].join(" ")}
        >
          <div>
            <p className="text-[12.5px] text-[rgb(var(--fg-default))]" style={{ fontWeight: 700 }}>
              Auto-confirm bookings
            </p>
            <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
              New requests skip approval and go straight to confirmed.
            </p>
          </div>
          <PillToggle
            label="Auto-confirm bookings"
            on={draftAuto}
            disabled={isSaving || !online}
            onChange={(next) => {
              const previous = draftAuto;
              persist({
                patch: { autoConfirmBookings: next },
                apply: () => {
                  setDraftAuto(next);
                },
                rollback: () => {
                  setDraftAuto(previous);
                },
                errorLabel: "Auto-confirm",
              });
            }}
          />
        </div>

        {/* Week starts on — display-only preference (client localStorage).
            Reorders the working-hours grid + mini-chart so Mon-first
            producers see their week the way they think about it. */}
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
          <div className="min-w-0">
            <p
              className="text-[12.5px] text-[rgb(var(--fg-default))]"
              style={{ fontWeight: 700 }}
            >
              Week starts on
            </p>
            <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
              Used by the calendar week grid.
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {(["sunday", "monday"] as const).map((opt) => {
              const isActive = opt === weekStart;
              const label = opt === "sunday" ? "Sunday" : "Monday";
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={isActive}
                  disabled={weekStartSaving || !online}
                  onClick={() => {
                    onWeekStartChange(opt);
                  }}
                  className={[
                    // 44px tap target below lg; compact h-7 on desktop.
                    "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border px-2.5 font-mono text-[11.5px] transition-colors disabled:cursor-wait disabled:opacity-60 lg:h-7",
                    isActive
                      ? "border-transparent bg-[rgb(var(--fg-default))] text-[rgb(var(--fg-inverse))]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cancellation window */}
        <div>
          <Eyebrow label="Cancellation window" />
          <ChipGroup
            options={CANCEL_HOURS.map((h) => ({
              value: h,
              label: `${String(h)}h`,
            }))}
            active={draftCancel}
            disabled={isSaving || !online}
            onChange={(v) => {
              const previous = draftCancel;
              persist({
                patch: { cancellationPolicyHours: v },
                apply: () => {
                  setDraftCancel(v);
                },
                rollback: () => {
                  setDraftCancel(previous);
                },
                errorLabel: "Cancellation window",
              });
            }}
          />
          <p className="mt-1 text-[10.5px] text-[rgb(var(--fg-muted))]">
            Artists must cancel this many hours before their session.
          </p>
        </div>

        {/* Timezone is informational until producers can persist a choice. */}
        <div>
          <Eyebrow label="Timezone" />
          <p className="mt-1.5 font-mono text-[12px] text-[rgb(var(--fg-muted))]">
            {getTimezoneLabel(timeZone, initialNow)}
          </p>
        </div>
      </div>
    </section>
  );
}

function ChipGroup<T extends number | string>({
  options,
  active,
  onChange,
  disabled = false,
}: {
  options: readonly { value: T; label: string }[];
  active: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(opt.value);
            }}
            aria-pressed={isActive}
            className={[
              // 44px tap target below lg; compact h-7 on desktop.
              "sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border px-2.5 font-mono text-[11.5px] transition-colors disabled:cursor-wait disabled:opacity-60 lg:h-7",
              isActive
                ? "border-transparent bg-[rgb(var(--fg-default))] text-[rgb(var(--fg-inverse))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
            ].join(" ")}
            style={{ fontWeight: 700 }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Blocked dates card ──────────────────────────────────────────────

function BlockedDatesCard({
  blackouts,
  online,
}: {
  blackouts: readonly Blackout[];
  online: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Blackout | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function handleRemove(id: string) {
    if (!online) {
      toast("Reconnect to remove a blocked date.", "error");
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await removeBlackout({ id });
        if (res.ok) {
          toast("Blocked date removed.", "success");
        } else {
          toast(res.error, "error");
        }
      } catch {
        toast("Could not remove this blocked date. Please try again.", "error");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <section
      aria-labelledby="blocked-dates-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <h2
          id="blocked-dates-heading"
          className="font-display text-[13px] tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Blocked dates
        </h2>
        <button
          type="button"
          disabled={!online}
          onClick={() => {
            setOpen(true);
          }}
          className="sk-press -m-2 p-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] transition-opacity hover:opacity-70 disabled:opacity-50"
          style={{ fontWeight: 700 }}
        >
          + Block dates
        </button>
      </header>

      {blackouts.length === 0 ? (
        <p className="px-4 py-5 text-[12.5px] text-[rgb(var(--fg-muted))]">
          No blocked dates.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 p-3">
          {blackouts.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 rounded-[8px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 py-2"
            >
              <PalmIcon />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[12.5px] text-[rgb(var(--fg-default))]"
                  style={{ fontWeight: 700 }}
                >
                  {b.reason ?? "Time off"}
                </p>
                <p className="font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                  {formatBlackoutRange(b.startDate, b.endDate)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Remove block"
                disabled={busyId === b.id}
                onClick={() => {
                  setRemoveTarget(b);
                }}
                className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-faint))] hover:text-[rgb(var(--fg-default))] disabled:opacity-50 lg:h-6 lg:w-6"
              >
                <XMini />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BlockDatesModal open={open} onOpenChange={setOpen} online={online} />
      <Dialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this blocked date?</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? `${removeTarget.reason ?? "Time off"} · ${formatBlackoutRange(removeTarget.startDate, removeTarget.endDate)}`
                : "This date will become bookable again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setRemoveTarget(null);
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-default))]"
            >
              Keep block
            </button>
            <button
              type="button"
              disabled={!removeTarget || busyId === removeTarget.id || !online}
              onClick={() => {
                if (!removeTarget) return;
                const target = removeTarget;
                setRemoveTarget(null);
                handleRemove(target.id);
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))] disabled:opacity-50"
            >
              Remove block
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BlockDatesModal({
  open,
  onOpenChange,
  online,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  online: boolean;
}) {
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setReason("");
    setFrom("");
    setTo("");
  }, [open]);

  function handleAdd() {
    if (!from) return;
    if (!online) {
      toast("Reconnect to block dates.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const res = await addBlackout({
          startDate: from,
          endDate: to || from,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        if (res.ok) {
          toast("Dates blocked.", "success");
          onOpenChange(false);
        } else {
          toast(res.error, "error");
        }
      } catch {
        toast("Could not block these dates. Please try again.", "error");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
      <div className="px-6 pt-6">
        <div
          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-[rgb(var(--brand-primary-dark))]"
          style={{
            background: "linear-gradient(135deg, rgb(var(--brand-primary) / 0.18), rgb(var(--brand-primary) / 0.06))",
          }}
        >
          <PalmIcon />
        </div>
        <DialogTitle
          className="mt-3 text-[20px]"
          style={{ fontWeight: 800, letterSpacing: "-0.025em" }}
        >
          Block dates
        </DialogTitle>
        <DialogDescription className="mt-1 text-[12.5px]">
          Mark a range as unavailable. Existing bookings stay on the calendar.
        </DialogDescription>
      </div>

      <div className="space-y-3 px-6 py-4">
        <Field label="Reason (optional)">
          <input
            type="text"
            autoFocus
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="Family vacation"
            className="h-11 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12.5px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none lg:h-9"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
              className="h-11 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[12px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none lg:h-9"
              style={{ fontWeight: 600 }}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              min={from}
              className="h-11 w-full rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[12px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none lg:h-9"
              style={{ fontWeight: 600 }}
            />
          </Field>
        </div>
        {from ? (
          <div
            className="rounded-[10px] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-3 py-2 font-mono text-[11.5px] text-[rgb(var(--brand-primary-dark))]"
            style={{ fontWeight: 600 }}
          >
            Blocking: {formatBlackoutRange(from, to || from)}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 rounded-b-[var(--radius-lg)] border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.4)] px-6 py-4">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
          className="sk-press inline-flex h-11 items-center justify-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[12.5px] text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-default))] lg:h-9"
          style={{ fontWeight: 600 }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!from || isPending || !online}
          className="sk-press inline-flex h-11 items-center justify-center rounded-[10px] bg-[rgb(var(--fg-default))] px-4 text-[12.5px] text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:h-9"
          style={{ fontWeight: 700 }}
        >
          {isPending ? "Saving…" : "Block dates"}
        </button>
      </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

type DraftWindow = { id: string; startMin: number; endMin: number };
type Draft = Record<number, DraftWindow[]>;

let nextId = 1;
function makeId(): string {
  nextId += 1;
  return `win-${String(nextId)}`;
}

function buildDraft(blocks: readonly Block[]): Draft {
  const out: Draft = {};
  for (const d of DAYS) out[d.num] = [];
  for (const b of [...blocks].sort((a, b) => a.startMin - b.startMin)) {
    const list = out[b.weekday];
    if (!list) continue;
    list.push({ id: makeId(), startMin: b.startMin, endMin: b.endMin });
  }
  return out;
}

function cloneWindows(ws: readonly DraftWindow[]): DraftWindow[] {
  return ws.map((w) => ({
    id: makeId(),
    startMin: w.startMin,
    endMin: w.endMin,
  }));
}

function serialiseDraft(draft: Draft): Block[] {
  const out: Block[] = [];
  for (const d of DAYS) {
    for (const w of draft[d.num] ?? []) {
      out.push({ weekday: d.num, startMin: w.startMin, endMin: w.endMin });
    }
  }
  return out;
}

function sameBlocks(a: readonly Block[], b: readonly Block[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (xs: readonly Block[]) =>
    [...xs]
      .sort(
        (x, y) =>
          x.weekday - y.weekday !== 0 ? x.weekday - y.weekday : x.startMin - y.startMin,
      )
      .map(
        (x) =>
          `${String(x.weekday)}:${String(x.startMin)}:${String(x.endMin)}`,
      )
      .join("|");
  return norm(a) === norm(b);
}

function computeTotals(draft: Draft): Record<number, number> {
  const out: Record<number, number> = {};
  for (const d of DAYS) {
    const ws = draft[d.num] ?? [];
    out[d.num] =
      Math.round(
        (ws.reduce((acc, w) => acc + Math.max(0, w.endMin - w.startMin), 0) /
          60) *
          10,
      ) / 10;
  }
  return out;
}

function sumHours(totals: Record<number, number>): number {
  let total = 0;
  for (const d of DAYS) total += totals[d.num] ?? 0;
  return Math.round(total * 10) / 10;
}

function formatHours(h: number): string {
  if (Number.isInteger(h)) return String(h);
  return h.toFixed(1).replace(/\.0$/, "");
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMin(v: string): number {
  const [h = "0", m = "0"] = v.split(":");
  return Number(h) * 60 + Number(m);
}

function buildSlots(): string[] {
  const out: string[] = [];
  for (let h = 6; h <= 23; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}

function getTimezoneLabel(timeZone: string, initialNow: string): string {
  try {
    const offset = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date(initialNow))
      .find((part) => part.type === "timeZoneName")?.value;
    return `${timeZone} · ${offset?.replace(/^UTC/, "GMT") ?? "GMT"}`;
  } catch {
    return "Local time";
  }
}

function formatBlackoutRange(start: string, end: string): string {
  const startD = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start === end) {
    return startD.toLocaleDateString("en-US", fmt);
  }
  return `${startD.toLocaleDateString("en-US", fmt)} – ${endD.toLocaleDateString(
    "en-US",
    fmt,
  )}`;
}

function Eyebrow({ label }: { label: string }) {
  return (
    <p
      className="font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
      style={{ fontWeight: 700 }}
    >
      {label}
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        style={{ fontWeight: 700 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function PalmIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-shrink-0 text-[rgb(var(--brand-primary-dark))]"
    >
      <path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4" />
      <path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3" />
      <path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25" />
      <path d="M11 15.5c.5 2.5 2 4.5 4 6l4-4c-1.5-2-3.5-3.5-6-4" />
      <path d="m12 12-2 8-2-2 1-3" />
    </svg>
  );
}

function XMini() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
