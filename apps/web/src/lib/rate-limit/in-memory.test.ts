import { describe, it, expect, beforeEach, vi } from "vitest";

import { checkRateLimit } from "./in-memory";

// Mock timers so we can advance wall-clock inside the window check.
// Without this the 1ms precision of sliding-window would flake on slow
// CI runners.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-17T00:00:00Z"));
});

describe("checkRateLimit", () => {
  it("allows hits up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      const res = checkRateLimit("k-1", 5, 60_000);
      expect(res.ok).toBe(true);
      expect(res.remaining).toBe(4 - i);
    }
  });

  it("rejects the hit that exceeds the limit", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("k-2", 3, 60_000);
    const res = checkRateLimit("k-2", 3, 60_000);
    expect(res.ok).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.resetMs).toBeGreaterThan(0);
  });

  it("resets after the window slides past", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("k-3", 3, 1000);
    expect(checkRateLimit("k-3", 3, 1000).ok).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(checkRateLimit("k-3", 3, 1000).ok).toBe(true);
  });

  it("separates keys (no cross-talk between producers)", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("prod-a", 5, 60_000);
    const forA = checkRateLimit("prod-a", 5, 60_000);
    const forB = checkRateLimit("prod-b", 5, 60_000);
    expect(forA.ok).toBe(false);
    expect(forB.ok).toBe(true);
  });
});
