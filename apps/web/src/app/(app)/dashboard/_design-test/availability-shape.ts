// Pure helpers for converting between the design-test Calendar
// editor's hoursByDay UI shape and the booking router's
// AvailabilityWeekInput block shape.
//
// The editor is one-range-per-day. The router supports up to 5
// blocks × 7 weekdays. When loading existing server-side data with
// multiple blocks on the same day, this module collapses them into
// the outer envelope (earliest start, latest end). Saving will
// then overwrite that day with a single block. This trade-off
// matches the mockup's simplified editor UI.

export const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type DayHours = { on: boolean; start: string; end: string };
export type HoursByDay = Record<DayKey, DayHours>;

export type AvailabilityBlock = {
  weekday: number;
  startMin: number;
  endMin: number;
};

export function parseHHMM(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0;
  return Math.max(0, Math.min(24 * 60, h * 60 + min));
}

export function formatHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const DAY_TO_WEEKDAY: Record<DayKey, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_TO_DAY: Record<number, DayKey> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function defaultHoursByDay(): HoursByDay {
  return {
    Sun: { on: false, start: "10:00", end: "18:00" },
    Mon: { on: false, start: "10:00", end: "18:00" },
    Tue: { on: false, start: "10:00", end: "18:00" },
    Wed: { on: false, start: "10:00", end: "18:00" },
    Thu: { on: false, start: "10:00", end: "18:00" },
    Fri: { on: false, start: "10:00", end: "18:00" },
    Sat: { on: false, start: "10:00", end: "18:00" },
  };
}

export function hoursByDayToBlocks(hoursByDay: HoursByDay): AvailabilityBlock[] {
  const out: AvailabilityBlock[] = [];
  for (const key of DAY_KEYS) {
    const day = hoursByDay[key];
    if (!day.on) continue;
    const startMin = parseHHMM(day.start);
    const endMin = parseHHMM(day.end);
    if (startMin >= endMin) continue;
    out.push({
      weekday: DAY_TO_WEEKDAY[key],
      startMin,
      endMin,
    });
  }
  return out;
}

export function blocksToHoursByDay(blocks: AvailabilityBlock[]): HoursByDay {
  const out = defaultHoursByDay();
  // Collapse multiple blocks on the same day into [min(start), max(end)].
  const byDay = new Map<number, { start: number; end: number }>();
  for (const b of blocks) {
    const cur = byDay.get(b.weekday);
    if (!cur) {
      byDay.set(b.weekday, { start: b.startMin, end: b.endMin });
    } else {
      byDay.set(b.weekday, {
        start: Math.min(cur.start, b.startMin),
        end: Math.max(cur.end, b.endMin),
      });
    }
  }
  for (const [weekday, range] of byDay) {
    const key = WEEKDAY_TO_DAY[weekday];
    if (!key) continue;
    out[key] = {
      on: true,
      start: formatHHMM(range.start),
      end: formatHHMM(range.end),
    };
  }
  return out;
}
