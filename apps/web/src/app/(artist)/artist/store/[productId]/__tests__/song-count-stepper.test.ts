import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeSongCountState as computeStepperState } from "~/components/artist/purchase/song-count-stepper";

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "components",
  "artist",
  "purchase",
  "song-count-stepper.tsx",
);
const source = readFileSync(componentPath, "utf8");

const TIERS = [
  { minQty: 1, pricePerUnitCents: 20000 },
  { minQty: 5, pricePerUnitCents: 15000 },
];

describe("unified song quantity calculation", () => {
  it("uses the deterministic shared volume ladder", () => {
    expect(computeStepperState(1, TIERS)).toEqual({
      qty: 1,
      unitPriceCents: 20000,
      totalCents: 20000,
      savedCents: 0,
    });
    expect(computeStepperState(5, TIERS)).toEqual({
      qty: 5,
      unitPriceCents: 15000,
      totalCents: 75000,
      savedCents: 25000,
    });
    expect(computeStepperState(10, TIERS).savedCents).toBe(50000);
  });

  it("defensively clamps the request quantity to at least one", () => {
    expect(computeStepperState(0, TIERS).qty).toBe(1);
    expect(computeStepperState(-3, TIERS).qty).toBe(1);
  });

  it("keeps empty ladders deterministic", () => {
    expect(computeStepperState(5, [])).toEqual({
      qty: 5,
      unitPriceCents: 0,
      totalCents: 0,
      savedCents: 0,
    });
  });
});

describe("unified song quantity control", () => {
  it("uses shared pricing math and emits the full calculated state", () => {
    expect(source).toMatch(/from "~\/lib\/pricing"/);
    expect(source).toMatch(/onChange\(state\)/);
    expect(source).toMatch(/savedCents/);
  });

  it("has true 44px controls and accessible names", () => {
    expect(source).toMatch(/aria-label="Increase songs"/);
    expect(source).toMatch(/aria-label="Decrease songs"/);
    expect(source.match(/h-11 w-11/g)?.length).toBe(2);
  });

  it("renders singular/plural quantity and the volume saving", () => {
    expect(source).toMatch(/state\.qty === 1 \? "song" : "songs"/);
    expect(source).toMatch(/Volume discount saves/);
  });
});
