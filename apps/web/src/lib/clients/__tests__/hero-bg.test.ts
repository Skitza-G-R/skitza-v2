import { describe, it, expect } from "vitest";
import { heroBg } from "../hero-bg";
import { GRADIENT_TOKENS } from "../derive-gradient";

describe("heroBg", () => {
  it("returns a CSS linear-gradient string for every known token", () => {
    for (const tok of GRADIENT_TOKENS) {
      const v = heroBg(tok);
      expect(v.startsWith("linear-gradient(")).toBe(true);
    }
  });

  it("returns the prototype's exact slate hero gradient", () => {
    expect(heroBg("grad-slate")).toBe(
      "linear-gradient(140deg,#1E2330 0%, #2B3142 50%, #3F4A60 100%)",
    );
  });
});
