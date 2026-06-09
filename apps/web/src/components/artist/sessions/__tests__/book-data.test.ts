import { describe, expect, it } from "vitest";

import {
  bookingActionLabel,
  buildProgressDots,
  cancelPolicy,
  formatSessionDate,
  formatSessionTime,
  formatShekels,
  progressMode,
} from "../book-data";

// Pure unit tests for the sessions helpers (no rendering). Mirrors the
// repo's existing pure-helper style (see purchase-data tests). Every
// helper takes its `now`/`today` injected — none read the runtime clock —
// so these assertions stay deterministic.

const HOUR = 3_600_000;

describe("progressMode", () => {
  it("returns 'count' when total is null (unlimited)", () => {
    expect(progressMode(null)).toBe("count");
  });

  it("returns 'dots' for small totals (<= 6)", () => {
    expect(progressMode(1)).toBe("dots");
    expect(progressMode(3)).toBe("dots");
    expect(progressMode(6)).toBe("dots");
  });

  it("returns 'bar' for larger totals (>= 7)", () => {
    expect(progressMode(7)).toBe("bar");
    expect(progressMode(12)).toBe("bar");
  });
});

describe("buildProgressDots", () => {
  it("returns one entry per total, the first `used` filled", () => {
    const dots = buildProgressDots(2, 4);
    expect(dots).toHaveLength(4);
    expect(dots.map((d) => d.filled)).toEqual([true, true, false, false]);
  });

  it("clamps used above total (never more filled than exist)", () => {
    const dots = buildProgressDots(9, 4);
    expect(dots).toHaveLength(4);
    expect(dots.every((d) => d.filled)).toBe(true);
  });

  it("clamps negative used to zero filled", () => {
    const dots = buildProgressDots(-3, 4);
    expect(dots).toHaveLength(4);
    expect(dots.every((d) => !d.filled)).toBe(true);
  });
});

describe("cancelPolicy", () => {
  it("is within policy when the session is comfortably ahead", () => {
    const res = cancelPolicy(48 * HOUR, 24, 0, "Gili Studio");
    expect(res.withinPolicy).toBe(true);
    expect(res.hoursUntil).toBe(48);
    expect(res.reason).toBeNull();
  });

  it("is outside policy (with a reason) when too close", () => {
    const res = cancelPolicy(2 * HOUR, 24, 0, "Gili Studio");
    expect(res.withinPolicy).toBe(false);
    expect(res.hoursUntil).toBe(2);
    expect(res.reason).toContain("Too close");
    expect(res.reason).toContain("Gili Studio");
  });

  it("treats exactly-at-the-window as within policy (inclusive boundary)", () => {
    const res = cancelPolicy(24 * HOUR, 24, 0, "Gili Studio");
    expect(res.withinPolicy).toBe(true);
    expect(res.reason).toBeNull();
  });
});

describe("bookingActionLabel", () => {
  it("asks to request when Gate 3 (approval) is on", () => {
    expect(bookingActionLabel(true)).toBe("Request this slot");
  });

  it("books directly when Gate 3 is off (auto-approve)", () => {
    expect(bookingActionLabel(false)).toBe("Book this slot");
  });
});

describe("formatSessionDate / formatSessionTime (UTC-safe)", () => {
  it("formats a fixed ISO deterministically", () => {
    const iso = "2026-06-09T14:30:00.000Z";
    expect(formatSessionDate(iso)).toBe("Tue, Jun 9");
    expect(formatSessionTime(iso)).toBe("2:30 PM");
  });
});

describe("formatShekels re-export", () => {
  it("re-exports the purchase-data formatter unchanged", () => {
    expect(formatShekels(240000)).toBe("₪2,400");
  });
});
