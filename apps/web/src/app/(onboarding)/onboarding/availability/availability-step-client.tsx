"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { setAvailabilityWeek } from "~/app/(producer)/dashboard/booking/actions";
import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";

import {
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_SUBTITLE,
  AVAILABILITY_STEP_TITLE,
  nextRouteAfterAvailability,
  routeOnBackFromAvailability,
  routeOnSkipFromAvailability,
} from "./constants";

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

const DEFAULT_START_MIN = 10 * 60;
const DEFAULT_END_MIN = 18 * 60;

const ROW_TEMPLATE: ReadonlyArray<{ weekday: Weekday; label: string; defaultActive: boolean }> = [
  { weekday: 0, label: "Sun", defaultActive: false },
  { weekday: 1, label: "Mon", defaultActive: true },
  { weekday: 2, label: "Tue", defaultActive: true },
  { weekday: 3, label: "Wed", defaultActive: true },
  { weekday: 4, label: "Thu", defaultActive: true },
  { weekday: 5, label: "Fri", defaultActive: true },
  { weekday: 6, label: "Sat", defaultActive: false },
];

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
      startMin: DEFAULT_START_MIN,
      endMin: DEFAULT_END_MIN,
    };
  });
}

function makeDefaultDays(): DayConfig[] {
  return ROW_TEMPLATE.map((row) => ({
    weekday: row.weekday,
    label: row.label,
    active: row.defaultActive,
    startMin: DEFAULT_START_MIN,
    endMin: DEFAULT_END_MIN,
  }));
}

export function AvailabilityStepClient({
  blocks,
}: {
  blocks: BlockInput[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<DayConfig[]>(() => buildInitialDays(blocks));

  const updateDay = (weekday: Weekday, patch: Partial<DayConfig>) => {
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  };

  const applyPreset = () => {
    setDays(makeDefaultDays());
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

  const onContinue = () => {
    advance(nextRouteAfterAvailability());
  };
  const onSkip = () => {
    advance(routeOnSkipFromAvailability());
  };
  const onBack = () => {
    router.push(routeOnBackFromAvailability());
  };

  return (
    <OnboardingShell
      currentStep={AVAILABILITY_STEP_INDEX}
      title={AVAILABILITY_STEP_TITLE}
      subtitle={AVAILABILITY_STEP_SUBTITLE}
      onBack={onBack}
      onSkip={onSkip}
      onContinue={onContinue}
      continueDisabled={pending}
    >
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyPreset}
            disabled={pending}
          >
            Use Mon–Fri, 10am–6pm
          </Button>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {days.map((day) => {
            const startStr = minutesToTime(day.startMin);
            const endStr = minutesToTime(day.endMin);
            const checkboxId = `avail-day-${String(day.weekday)}`;
            return (
              <li
                key={day.weekday}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={day.active}
                  onChange={(e) => {
                    updateDay(day.weekday, { active: e.target.checked });
                  }}
                  className="h-4 w-4 cursor-pointer accent-primary"
                  disabled={pending}
                />
                <label
                  htmlFor={checkboxId}
                  className="w-12 cursor-pointer font-medium text-foreground"
                >
                  {day.label}
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="time"
                    value={startStr}
                    disabled={!day.active || pending}
                    onChange={(e) => {
                      updateDay(day.weekday, { startMin: timeToMinutes(e.target.value) });
                    }}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="time"
                    value={endStr}
                    disabled={!day.active || pending}
                    onChange={(e) => {
                      updateDay(day.weekday, { endMin: timeToMinutes(e.target.value) });
                    }}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </OnboardingShell>
  );
}
