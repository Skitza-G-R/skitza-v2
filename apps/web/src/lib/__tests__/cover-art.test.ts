import { describe, expect, it } from "vitest";

import { COVER_HUES, coverForId, hueForId, skCover, skSwatch, swatchForId } from "../cover-art";

describe("skCover", () => {
  it("layers the vignette over a 3-stop oklch gradient with +8/+24 hue drift", () => {
    const css = skCover(44);
    expect(css).toMatch(/^radial-gradient\(/);
    expect(css).toContain("linear-gradient(168deg");
    expect(css).toContain("oklch(0.82 0.075 44)");
    expect(css).toContain("oklch(0.60 0.13 52)");
    expect(css).toContain("oklch(0.42 0.135 68)");
  });

  it("wraps hues past 360", () => {
    const css = skCover(340);
    expect(css).toContain("oklch(0.82 0.075 340)");
    expect(css).toContain("oklch(0.60 0.13 348)");
    expect(css).toContain("oklch(0.42 0.135 4)");
  });

  it("normalizes negative and oversized hues", () => {
    expect(skCover(-20)).toEqual(skCover(340));
    expect(skCover(404)).toEqual(skCover(44));
  });
});

describe("skSwatch", () => {
  it("is a 2-stop gradient with +30 hue drift", () => {
    const css = skSwatch(30);
    expect(css).toBe("linear-gradient(135deg, oklch(0.72 0.13 30) 0%, oklch(0.46 0.14 60) 100%)");
  });

  it("wraps the second stop past 360", () => {
    expect(skSwatch(340)).toContain("oklch(0.46 0.14 10)");
  });
});

describe("hueForId", () => {
  it("is deterministic for the same id", () => {
    expect(hueForId("prod-abc")).toBe(hueForId("prod-abc"));
  });

  it("always lands inside the warm palette", () => {
    const hues: readonly number[] = COVER_HUES;
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "longer-uuid-1234"]) {
      expect(hues).toContain(hueForId(id));
    }
  });

  it("spreads different ids across more than one hue", () => {
    const seen = new Set(Array.from({ length: 32 }, (_, i) => hueForId(`product-${String(i)}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("id conveniences", () => {
  it("coverForId/swatchForId compose hash + gradient", () => {
    const id = "0b0e5c3a-1111-4222-8333-444455556666";
    expect(coverForId(id)).toBe(skCover(hueForId(id)));
    expect(swatchForId(id)).toBe(skSwatch(hueForId(id)));
  });
});
