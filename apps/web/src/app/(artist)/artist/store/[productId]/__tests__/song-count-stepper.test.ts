import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeStepperState } from "../song-count-stepper";

// Repo convention: vitest runs in `node` env, no jsdom. We test the
// pure math helper directly and source-grep the JSX shell for the
// accessibility + interaction invariants.

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "song-count-stepper.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

const TIERS = [
  { minQty: 1, pricePerUnitCents: 20000 },
  { minQty: 5, pricePerUnitCents: 15000 },
];

// ─── computeStepperState — pure math ──────────────────────────────────

describe("computeStepperState", () => {
  it("starts at qty 1: base price, total = base, no savings", () => {
    expect(computeStepperState(1, TIERS)).toEqual({
      qty: 1,
      unitPriceCents: 20000,
      totalCents: 20000,
      savedCents: 0,
    });
  });

  it("stays on base tier when qty is below the first discount", () => {
    expect(computeStepperState(3, TIERS)).toEqual({
      qty: 3,
      unitPriceCents: 20000,
      totalCents: 60000,
      savedCents: 0,
    });
  });

  it("switches to the discount tier at the trigger qty", () => {
    expect(computeStepperState(5, TIERS)).toEqual({
      qty: 5,
      unitPriceCents: 15000,
      totalCents: 75000,
      savedCents: 25000,
    });
  });

  it("scales savings with qty above the discount trigger", () => {
    expect(computeStepperState(10, TIERS)).toEqual({
      qty: 10,
      unitPriceCents: 15000,
      totalCents: 150000,
      savedCents: 50000,
    });
  });

  it("clamps qty 0 to 1 (defensive against external state bugs)", () => {
    const state = computeStepperState(0, TIERS);
    expect(state.qty).toBe(1);
    expect(state.unitPriceCents).toBe(20000);
  });

  it("clamps negative qty to 1", () => {
    expect(computeStepperState(-3, TIERS).qty).toBe(1);
  });

  it("returns all zeros when tiers is empty (defensive)", () => {
    expect(computeStepperState(5, [])).toEqual({
      qty: 5,
      unitPriceCents: 0,
      totalCents: 0,
      savedCents: 0,
    });
  });
});

// ─── Source-grep on the JSX shell ─────────────────────────────────────

describe("song-count-stepper.tsx source", () => {
  it("is a client component (needs interactivity)", () => {
    expect(source).toMatch(/^["']use client["']/m);
  });

  it("uses useState to manage local qty", () => {
    expect(source).toMatch(/useState/);
  });

  it("provides aria-labels on the +/- buttons for screen readers", () => {
    expect(source).toMatch(/aria-label=["']Increase songs["']/i);
    expect(source).toMatch(/aria-label=["']Decrease songs["']/i);
  });

  it("renders 'song' singular for qty 1 and 'songs' plural elsewhere", () => {
    expect(source).toMatch(/qty\s*===\s*1[\s\S]{0,60}song/);
  });

  it("emits qty + unitPriceCents via onChange when state changes", () => {
    expect(source).toMatch(/onChange\(\s*\{\s*qty[\s\S]{0,120}unitPriceCents/);
  });

  it("renders a 'save' savings hint (shown only when a discount tier is active)", () => {
    expect(source).toMatch(/save/i);
    expect(source).toMatch(/savedCents/);
  });

  it("imports the shared pricing math from ~/lib/pricing", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/pricing['"]/);
  });
});
