import { describe, it, expect } from "vitest";

import {
  PROGRESS_TOTAL,
  progressBarA11y,
  segmentClass,
  segmentState,
} from "../progress-bar";

// Story 02 of the onboarding rebuild: the 4-segment progress bar at
// the top of every step. The component stays presentational; the
// data-shape that drives every segment's className + ARIA attrs is
// exported so tests can assert behaviour without RTL (the repo
// runs vitest in `node` env — no jsdom — so we mirror the
// autopilot SWITCHES + Sidebar NAV_ITEMS conventions and pin the
// pure helpers instead of the rendered DOM).

describe("Onboarding progress bar contract (Story 02)", () => {
  it("expects exactly 4 segments per the architecture spec", () => {
    expect(PROGRESS_TOTAL).toBe(4);
  });

  it("segmentState returns 'completed' for indices < current", () => {
    // current = 3 → segments at index 0 and 1 are completed
    expect(segmentState(0, 3)).toBe("completed");
    expect(segmentState(1, 3)).toBe("completed");
  });

  it("segmentState returns 'active' for the current index (1-indexed → index === current - 1)", () => {
    expect(segmentState(2, 3)).toBe("active");
    expect(segmentState(0, 1)).toBe("active");
  });

  it("segmentState returns 'pending' for indices > current - 1", () => {
    expect(segmentState(3, 3)).toBe("pending");
    expect(segmentState(2, 1)).toBe("pending");
    expect(segmentState(3, 1)).toBe("pending");
  });

  it("segmentClass uses --brand-primary for active, 0.6 alpha for completed, --border-subtle for pending", () => {
    expect(segmentClass("active")).toContain("rgb(var(--brand-primary))");
    expect(segmentClass("completed")).toContain("rgb(var(--brand-primary)/0.6)");
    expect(segmentClass("pending")).toContain("rgb(var(--border-subtle))");
  });

  it("every segment class is a flex-1 1px-tall pill (no fixed widths, no hex colors)", () => {
    for (const state of ["active", "completed", "pending"] as const) {
      const cls = segmentClass(state);
      expect(cls).toMatch(/flex-1/);
      expect(cls).toMatch(/h-1/);
      expect(cls).toMatch(/rounded-full/);
      // Repo-wide rule: no hex colors anywhere.
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("progressBarA11y emits role=progressbar + correct aria-valuenow/min/max/label", () => {
    expect(progressBarA11y(2)).toEqual({
      role: "progressbar",
      "aria-valuenow": 2,
      "aria-valuemin": 1,
      "aria-valuemax": 4,
      "aria-label": "Onboarding progress",
    });
  });

  it("progressBarA11y mirrors current verbatim into aria-valuenow", () => {
    expect(progressBarA11y(1)["aria-valuenow"]).toBe(1);
    expect(progressBarA11y(4)["aria-valuenow"]).toBe(4);
  });
});
