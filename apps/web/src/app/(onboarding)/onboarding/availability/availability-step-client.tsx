"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAvailabilityWeek } from "~/app/(producer)/dashboard/booking/actions";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useToast } from "~/components/ui/toast";

import {
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_SUBTITLE,
  AVAILABILITY_STEP_TITLE,
  nextRouteAfterAvailability,
  routeOnBackFromAvailability,
  routeOnSkipFromAvailability,
} from "./constants";

// Step 3 — When you work. May 2026 redesign.
//
// Preset chips (Weekdays · 10–18, Evenings · 18–22, Weekends only,
// Split · 10–13 + 14–19) one-tap fill the day rows. Then a 7-row
// Mon-Sun grid with start/end time pickers per active day. Inactive
// days are dimmed.
//
// Auto-saves to producers.availability via setAvailabilityWeek on
// Continue (existing booking action — no schema change).

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface DayConfig {
  weekday: Weekday;
  label: string;
  active: boolean;
  startMin: number;
  endMin: number;
}

interface BlockInput {
  weekday: number;
  startMin: number;
  endMin: number;
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

const PRESETS = [
  { id: "weekdays", label: "Weekdays · 10–18" },
  { id: "evenings", label: "Evenings · 18–22" },
  { id: "weekends", label: "Weekends only" },
  { id: "split", label: "Split · 10–13, 14–19" },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

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
  const byWeekday = new Map<number, BlockInput>();
  for (const b of blocks) byWeekday.set(b.weekday, b);
  return ROW_TEMPLATE.map((row) => {
    const stored = byWeekday.get(row.weekday);
    if (stored) {
      return {
        weekday: row.weekday,
        label: row.label,
        active: true,
        startMin: stored.startMin,
        endMin: stored.endMin,
      };
    }
    return {
      weekday: row.weekday,
      label: row.label,
      active: row.defaultActive,
      startMin: 10 * 60,
      endMin: 18 * 60,
    };
  });
}

function applyPreset(preset: PresetId, days: DayConfig[]): DayConfig[] {
  return days.map((d) => {
    const isWeekday = d.weekday >= 1 && d.weekday <= 5;
    const isWeekend = d.weekday === 0 || d.weekday === 6;
    switch (preset) {
      case "weekdays":
        return {
          ...d,
          active: isWeekday,
          startMin: 10 * 60,
          endMin: 18 * 60,
        };
      case "evenings":
        return {
          ...d,
          active: isWeekday,
          startMin: 18 * 60,
          endMin: 22 * 60,
        };
      case "weekends":
        return {
          ...d,
          active: isWeekend,
          startMin: 10 * 60,
          endMin: 18 * 60,
        };
      case "split":
        // Two-window split is conceptually richer than the legacy
        // single-block schema can express; for now fill the day with
        // the broader 10–19 envelope so producers see *something*
        // sensible after tapping the preset, and they can refine in
        // /dashboard/calendar after onboarding. A real two-window
        // editor is a separate brief.
        return {
          ...d,
          active: isWeekday,
          startMin: 10 * 60,
          endMin: 19 * 60,
        };
    }
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

  const updateDay = (weekday: Weekday, patch: Partial<DayConfig>) => {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  };

  const collectBlocks = (): BlockInput[] =>
    days
      .filter((d) => d.active && d.endMin > d.startMin)
      .map((d) => ({ weekday: d.weekday, startMin: d.startMin, endMin: d.endMin }));

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
          onBack={() => router.push(routeOnBackFromAvailability())}
          onSkip={() => advance(routeOnSkipFromAvailability())}
          onContinue={() => advance(nextRouteAfterAvailability())}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 3 of 5 · Required
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {AVAILABILITY_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {AVAILABILITY_STEP_SUBTITLE}
        </p>

        {/* Preset chips */}
        <div className="mt-6 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDays((prev) => applyPreset(p.id, prev))}
              disabled={pending}
              className="sk-pop rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.08)]"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Day rows */}
        <ul className="mt-5 divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          {days.map((day) => {
            const startStr = minutesToTime(day.startMin);
            const endStr = minutesToTime(day.endMin);
            return (
              <li
                key={day.weekday}
                className={`flex items-center gap-3 px-4 py-3 text-[13px] transition-opacity ${
                  day.active ? "opacity-100" : "opacity-50"
                }`}
              >
                {/* Active toggle dot */}
                <button
                  type="button"
                  onClick={() =>
                    updateDay(day.weekday, { active: !day.active })
                  }
                  aria-label={`${day.active ? "Disable" : "Enable"} ${day.label}`}
                  className={`sk-pop h-4 w-4 flex-shrink-0 rounded-full border transition-colors ${
                    day.active
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]"
                      : "border-[rgb(var(--border-strong))] bg-transparent"
                  }`}
                />
                <span className="w-10 font-bold text-[rgb(var(--fg-default))]">
                  {day.label}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="time"
                    value={startStr}
                    disabled={!day.active || pending}
                    onChange={(e) =>
                      updateDay(day.weekday, {
                        startMin: timeToMinutes(e.target.value),
                      })
                    }
                    className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2.5 py-1.5 font-mono text-[12px] text-[rgb(var(--fg-default))] outline-none transition-shadow focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgba(212,150,10,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="text-[rgb(var(--fg-faint))]">–</span>
                  <input
                    type="time"
                    value={endStr}
                    disabled={!day.active || pending}
                    onChange={(e) =>
                      updateDay(day.weekday, {
                        endMin: timeToMinutes(e.target.value),
                      })
                    }
                    className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2.5 py-1.5 font-mono text-[12px] text-[rgb(var(--fg-default))] outline-none transition-shadow focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgba(212,150,10,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </WizardChrome>
  );
}
