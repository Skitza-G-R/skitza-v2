// SK-264 — single source of truth for weekly availability window rules.
//
// Used by the onboarding "When you work" step, the Calendar →
// Availability tab, and the booking router's setWeek input. Before this
// module the three surfaces disagreed: onboarding capped 3 windows per
// day, the Availability tab allowed unlimited, and the router only
// capped 35 blocks total — and invalid drafts surfaced as an
// unreadable server error instead of an inline reason.

export const MAX_WINDOWS_PER_DAY = 5;
export const MIN_WINDOW_MINUTES = 30;
export const DAY_END_MIN = 24 * 60;

export type AvailabilityWindow = { startMin: number; endMin: number };

export type DayWindowsIssue = "start_after_end" | "too_short" | "overlap" | "too_many";

/**
 * First problem with one day's windows, or null when the day is fine.
 * Per-window problems (reversed, too short) win over cross-window ones
 * so the message points at what the producer just typed.
 */
export function findDayWindowsIssue(
  windows: readonly AvailabilityWindow[],
): DayWindowsIssue | null {
  for (const w of windows) {
    if (w.endMin <= w.startMin) return "start_after_end";
    if (w.endMin - w.startMin < MIN_WINDOW_MINUTES) return "too_short";
  }
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i];
      const b = windows[j];
      if (!a || !b) continue;
      if (a.startMin < b.endMin && b.startMin < a.endMin) return "overlap";
    }
  }
  if (windows.length > MAX_WINDOWS_PER_DAY) return "too_many";
  return null;
}

export function dayWindowsIssueMessage(issue: DayWindowsIssue): string {
  switch (issue) {
    case "start_after_end":
      return "End time must be after start time.";
    case "too_short":
      return `Each window needs at least ${String(MIN_WINDOW_MINUTES)} minutes.`;
    case "overlap":
      return "Time windows can't overlap.";
    case "too_many":
      return `You can add up to ${String(MAX_WINDOWS_PER_DAY)} windows per day.`;
  }
}

const DEFAULT_SLOT: AvailabilityWindow = { startMin: 9 * 60, endMin: 17 * 60 };
const APPEND_LENGTH_MIN = 2 * 60;

/**
 * Where "+ Add window" should place the next window: a two-hour slot
 * after the last window, else the first gap in the day that can hold a
 * minimum window, else null when the day is genuinely full. Replaces
 * the old behaviour of appending 23:00–24:00 windows forever, which
 * piled up overlapping duplicates the time dropdown could not even
 * display.
 */
export function nextWindowSlot(
  windows: readonly AvailabilityWindow[],
): AvailabilityWindow | null {
  if (windows.length === 0) return { ...DEFAULT_SLOT };
  // Count each window by the span it occupies so a temporarily
  // reversed draft (end before start) still blocks its time range.
  const occupied = windows
    .map((w) => ({
      start: Math.max(0, Math.min(w.startMin, w.endMin)),
      end: Math.min(DAY_END_MIN, Math.max(w.startMin, w.endMin)),
    }))
    .sort((a, b) => a.start - b.start);

  const lastEnd = Math.max(...occupied.map((s) => s.end));
  if (DAY_END_MIN - lastEnd >= MIN_WINDOW_MINUTES) {
    return {
      startMin: lastEnd,
      endMin: Math.min(lastEnd + APPEND_LENGTH_MIN, DAY_END_MIN),
    };
  }

  let cursor = 0;
  for (const span of occupied) {
    if (span.start - cursor >= MIN_WINDOW_MINUTES) {
      return {
        startMin: cursor,
        endMin: Math.min(cursor + APPEND_LENGTH_MIN, span.start),
      };
    }
    cursor = Math.max(cursor, span.end);
  }
  return null;
}

export type WeekBlock = { weekday: number; startMin: number; endMin: number };
export type WeekBlockIssue = { index: number; message: string };

/**
 * Week-level validation for the booking router's setWeek input. Keeps
 * the router's original messages ("start must be before end",
 * "overlaps another block on the same weekday") and adds the per-day
 * cap the router's 35-total limit was always meant to imply.
 */
export function findWeekBlocksIssues(blocks: readonly WeekBlock[]): WeekBlockIssue[] {
  const issues: WeekBlockIssue[] = [];
  const perDayCount = new Map<number, number>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    if (b.startMin >= b.endMin) {
      issues.push({ index: i, message: "start must be before end" });
    }
    for (let j = i + 1; j < blocks.length; j++) {
      const other = blocks[j];
      if (!other || other.weekday !== b.weekday) continue;
      if (b.startMin < other.endMin && other.startMin < b.endMin) {
        issues.push({ index: j, message: "overlaps another block on the same weekday" });
      }
    }
    const count = (perDayCount.get(b.weekday) ?? 0) + 1;
    perDayCount.set(b.weekday, count);
    if (count === MAX_WINDOWS_PER_DAY + 1) {
      issues.push({
        index: i,
        message: `more than ${String(MAX_WINDOWS_PER_DAY)} windows on the same weekday`,
      });
    }
  }
  return issues;
}
