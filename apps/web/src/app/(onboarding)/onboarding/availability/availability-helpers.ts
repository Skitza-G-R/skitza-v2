// Pure helpers for Step 3 (availability / "When you work"). Kept
// JSX/React-free so the vitest `node` env can import them directly —
// same RSC-safe discipline as constants.ts.

export interface WindowConfig {
  startMin: number;
  endMin: number;
}

/** Default window for a freshly-enabled day: 10:00–18:00. */
export const DEFAULT_WINDOW: WindowConfig = {
  startMin: 10 * 60,
  endMin: 18 * 60,
};

/**
 * Compute the time window appended when the user clicks "+ add window"
 * on a day that already has at least one window.
 *
 * The previous behaviour was to clone DEFAULT_WINDOW (10:00–18:00),
 * which produced two identical rows and forced the user to retype both
 * times. Real-world expectation: the second window starts AFTER the
 * first ends — typical patterns are morning/afternoon split (lunch
 * break) or daytime/evening split.
 *
 * Strategy:
 *   1. Try a 1-hour gap then a 4-hour block (e.g. 18:00 → 19:00–23:00).
 *   2. If that overflows the day, squeeze a slot from last.end + 30min
 *      to 23:59.
 *   3. If even that has no room (last block ends ~23:30+), fall back
 *      to DEFAULT_WINDOW so the user still gets something editable.
 */
export function buildNextWindow(
  prev: ReadonlyArray<WindowConfig>,
): WindowConfig {
  const last = prev[prev.length - 1];
  if (!last) return { ...DEFAULT_WINDOW };

  const GAP_MIN = 60;
  const DURATION_MIN = 4 * 60;
  const END_OF_DAY = 23 * 60 + 59; // 23:59 — `<input type="time">` cap.

  const desiredStart = last.endMin + GAP_MIN;
  const desiredEnd = desiredStart + DURATION_MIN;

  if (desiredEnd <= END_OF_DAY) {
    return { startMin: desiredStart, endMin: desiredEnd };
  }

  if (last.endMin + 30 <= END_OF_DAY) {
    return { startMin: last.endMin + 30, endMin: END_OF_DAY };
  }

  return { ...DEFAULT_WINDOW };
}
