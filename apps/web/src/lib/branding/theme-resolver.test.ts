import { describe, it, expect } from "vitest";
import { resolveBrandStyle, defaultBrand } from "./theme-resolver";

describe("resolveBrandStyle", () => {
  it("returns default tokens when brand is empty", () => {
    expect(resolveBrandStyle({})["--brand-primary"]).toBe(defaultBrand.primary);
  });
  it("overrides primary + accent when valid hex provided", () => {
    const style = resolveBrandStyle({ primary: "#ff0066", accent: "#33ccff" });
    expect(style["--brand-primary"]).toBe("255 0 102");
    expect(style["--brand-accent"]).toBe("51 204 255");
  });
  it("falls back to default when hex is invalid", () => {
    expect(resolveBrandStyle({ primary: "not-a-color" })["--brand-primary"]).toBe(defaultBrand.primary);
  });
});
