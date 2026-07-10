import { describe, expect, it } from "vitest";

import { lerp, stickyBtnBackground, stickyEase, stickyIconColor } from "../sticky-nav-math";

describe("stickyEase", () => {
  it("is 0 before the start threshold", () => {
    expect(stickyEase(0)).toBe(0);
    expect(stickyEase(46)).toBe(0);
  });

  it("is 1 at and past the end threshold", () => {
    expect(stickyEase(116)).toBe(1);
    expect(stickyEase(900)).toBe(1);
  });

  it("smoothsteps the midpoint", () => {
    // halfway between 46 and 116 → p = .5 → smoothstep = .5
    expect(stickyEase(81)).toBeCloseTo(0.5, 5);
    // smoothstep eases: quarter-way progress is below linear
    expect(stickyEase(63.5)).toBeLessThan(0.25);
  });

  it("respects custom thresholds", () => {
    expect(stickyEase(10, 10, 20)).toBe(0);
    expect(stickyEase(20, 10, 20)).toBe(1);
  });
});

describe("crossfade colors", () => {
  it("starts as dark glass and ends near-solid white", () => {
    expect(stickyBtnBackground(0)).toBe("rgba(20,18,12,0.34)");
    expect(stickyBtnBackground(1)).toBe("rgba(255,255,255,0.92)");
  });

  it("icon goes white-over-cover to warm ink", () => {
    expect(stickyIconColor(0)).toBe("rgb(255,255,255)");
    expect(stickyIconColor(1)).toBe("rgb(17,16,9)");
  });
});

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0.3)).toBeCloseTo(3);
    expect(lerp(-5, 5, 0.5)).toBe(0);
  });
});
