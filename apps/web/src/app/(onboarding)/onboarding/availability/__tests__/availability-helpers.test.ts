import { describe, expect, it } from "vitest";

import {
  buildNextWindow,
  DEFAULT_WINDOW,
  type WindowConfig,
} from "../availability-helpers";

// Step 3 "+ add window" default. Reproduces the bug Gili reported on
// 2026-05-09: clicking + duplicated 10:00–18:00 instead of suggesting
// a window that starts AFTER the previous one ends.

describe("buildNextWindow — Step 3 'add window' default", () => {
  it("falls back to DEFAULT_WINDOW when there are no prior windows", () => {
    expect(buildNextWindow([])).toEqual(DEFAULT_WINDOW);
  });

  it("starts 1 hour after the last window and runs 4 hours by default", () => {
    // 10:00–18:00 → next should be 19:00–23:00, NOT another 10:00–18:00.
    const result = buildNextWindow([{ startMin: 10 * 60, endMin: 18 * 60 }]);
    expect(result).toEqual({ startMin: 19 * 60, endMin: 23 * 60 });
  });

  it("uses the LAST window when there are multiple", () => {
    const result = buildNextWindow([
      { startMin: 9 * 60, endMin: 12 * 60 }, // 09:00–12:00
      { startMin: 13 * 60, endMin: 17 * 60 }, // 13:00–17:00 ← reference
    ]);
    expect(result).toEqual({ startMin: 18 * 60, endMin: 22 * 60 });
  });

  it("clamps to end-of-day when the 4-hour block would overflow", () => {
    // last ends 21:00 → desired 22:00–02:00 overflows → squeeze to 21:30–23:59.
    const result = buildNextWindow([{ startMin: 10 * 60, endMin: 21 * 60 }]);
    expect(result).toEqual({ startMin: 21 * 60 + 30, endMin: 23 * 60 + 59 });
  });

  it("falls back to DEFAULT_WINDOW when the last block ends too late to fit anything", () => {
    // last ends 23:45 → no realistic room → safe default the user can edit.
    const result = buildNextWindow([
      { startMin: 10 * 60, endMin: 23 * 60 + 45 },
    ]);
    expect(result).toEqual(DEFAULT_WINDOW);
  });

  it("never duplicates the previous window verbatim", () => {
    // The exact regression: '+' must not yield 10:00–18:00 again.
    const last: WindowConfig = { startMin: 10 * 60, endMin: 18 * 60 };
    const next = buildNextWindow([last]);
    expect(next.startMin).toBeGreaterThanOrEqual(last.endMin);
    expect(next).not.toEqual(last);
  });
});
