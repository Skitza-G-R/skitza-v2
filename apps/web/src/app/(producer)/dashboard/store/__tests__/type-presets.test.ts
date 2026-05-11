import { describe, expect, it } from "vitest";

import { TYPE_PRESETS, getPreset } from "../type-presets";

describe("TYPE_PRESETS", () => {
  it("exposes exactly four preset cards in the order production, mix, master, blank", () => {
    expect(TYPE_PRESETS.map((p) => p.id)).toEqual([
      "production",
      "mix",
      "master",
      "blank",
    ]);
  });

  it("each preset has a label, desc, defaultName, baseline list, extras list, and preset object", () => {
    for (const p of TYPE_PRESETS) {
      expect(p.label).toBeTypeOf("string");
      expect(p.desc).toBeTypeOf("string");
      expect(p.defaultName).toBeTypeOf("string");
      expect(Array.isArray(p.baseline)).toBe(true);
      expect(Array.isArray(p.extras)).toBe(true);
      expect(p.preset).toBeTypeOf("object");
    }
  });

  it("production preset seeds $2500 multi-session with split payment", () => {
    const prod = getPreset("production");
    expect(prod?.preset.price).toBe(2500);
    expect(prod?.preset.duration).toBe("multi-session");
    expect(prod?.preset.sessions).toBe(8);
    expect(prod?.preset.paymentPlan).toBe("split");
  });

  it("blank preset has empty baseline + extras so the user starts fresh", () => {
    const blank = getPreset("blank");
    expect(blank?.baseline).toHaveLength(0);
    expect(blank?.extras).toHaveLength(0);
  });

  it("getPreset returns undefined for unknown ids", () => {
    expect(getPreset("zzz" as never)).toBeUndefined();
  });
});
