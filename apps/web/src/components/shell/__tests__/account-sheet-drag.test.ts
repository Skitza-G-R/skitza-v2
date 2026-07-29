import { describe, expect, it } from "vitest";

import {
  accountSheetDragOffset,
  accountSheetReleaseVelocity,
  shouldDismissAccountSheet,
} from "../account-sheet-drag";

describe("account sheet direct drag", () => {
  it("follows downward movement exactly and reverses upward with resistance", () => {
    expect(accountSheetDragOffset(132)).toBe(132);
    expect(accountSheetDragOffset(44)).toBe(44);
    expect(accountSheetDragOffset(0)).toBe(0);
    expect(accountSheetDragOffset(-40)).toBeCloseTo(-7.2);
    expect(accountSheetDragOffset(-400)).toBe(-24);
  });

  it("dismisses after a deliberate drag past the distance threshold", () => {
    expect(
      shouldDismissAccountSheet({
        distancePx: 170,
        velocityPxPerMs: 0.2,
        sheetHeightPx: 600,
      }),
    ).toBe(true);
  });

  it("dismisses a short intentional downward flick", () => {
    expect(
      shouldDismissAccountSheet({
        distancePx: 36,
        velocityPxPerMs: 0.9,
        sheetHeightPx: 600,
      }),
    ).toBe(true);
  });

  it("springs back after a short slow drag or an upward release", () => {
    expect(
      shouldDismissAccountSheet({
        distancePx: 40,
        velocityPxPerMs: 0.2,
        sheetHeightPx: 600,
      }),
    ).toBe(false);
    expect(
      shouldDismissAccountSheet({
        distancePx: -80,
        velocityPxPerMs: -0.6,
        sheetHeightPx: 600,
      }),
    ).toBe(false);
  });

  it("decays a stale move velocity so a paused release settles by position", () => {
    expect(
      accountSheetReleaseVelocity({
        previousVelocityPxPerMs: 1.2,
        lastY: 140,
        lastTime: 20,
        releaseY: 140,
        releaseTime: 200,
      }),
    ).toBe(0);
    expect(
      accountSheetReleaseVelocity({
        previousVelocityPxPerMs: 1.2,
        lastY: 140,
        lastTime: 20,
        releaseY: 140,
        releaseTime: 40,
      }),
    ).toBeCloseTo(0.96);
  });

  it("uses a final pointer-up reversal instead of stale downward velocity", () => {
    expect(
      accountSheetReleaseVelocity({
        previousVelocityPxPerMs: 2,
        lastY: 140,
        lastTime: 20,
        releaseY: 125,
        releaseTime: 30,
      }),
    ).toBe(-1.5);
  });

  it("never turns a non-monotonic final sample into a false flick", () => {
    for (const releaseY of [140, 150]) {
      const velocity = accountSheetReleaseVelocity({
        previousVelocityPxPerMs: 2,
        lastY: 140,
        lastTime: 30,
        releaseY,
        releaseTime: 20,
      });
      expect(velocity).toBe(0);
      expect(Number.isFinite(velocity)).toBe(true);
    }
  });

  it("honors a fractional upward release instead of stale downward velocity", () => {
    expect(
      accountSheetReleaseVelocity({
        previousVelocityPxPerMs: 2,
        lastY: 140,
        lastTime: 20,
        releaseY: 139.75,
        releaseTime: 30,
      }),
    ).toBe(-0.025);
  });
});
