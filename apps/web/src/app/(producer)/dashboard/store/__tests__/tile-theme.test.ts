import { describe, expect, it } from "vitest";

import { TILE_THEME } from "../tile-theme";

describe("TILE_THEME", () => {
  it("has exactly the 4 tile types", () => {
    expect(Object.keys(TILE_THEME).sort()).toEqual([
      "consult",
      "master",
      "mix",
      "production",
    ]);
  });

  it("each tile defines gradient, iconName, and accent", () => {
    for (const t of Object.values(TILE_THEME)) {
      expect(t.gradient).toMatch(/linear-gradient/);
      expect(t.iconName).toBeTypeOf("string");
      expect(t.iconName.length).toBeGreaterThan(0);
      expect(t.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("uses the four canonical Lucide icons", () => {
    expect(TILE_THEME.mix.iconName).toBe("sliders-horizontal");
    expect(TILE_THEME.master.iconName).toBe("volume-2");
    expect(TILE_THEME.production.iconName).toBe("music-2");
    expect(TILE_THEME.consult.iconName).toBe("message-square");
  });
});
