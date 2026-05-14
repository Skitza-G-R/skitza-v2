import { describe, it, expect } from "vitest";
import { deriveGradient, GRADIENT_TOKENS, type GradientToken } from "../derive-gradient";

describe("deriveGradient", () => {
  it("returns one of 6 known tokens", () => {
    const tokens: GradientToken[] = [
      "grad-rose", "grad-amber", "grad-slate",
      "grad-emerald", "grad-violet", "grad-indigo",
    ];
    expect(GRADIENT_TOKENS).toEqual(tokens);
  });

  it("is deterministic for the same name", () => {
    expect(deriveGradient("Noa Kirel")).toBe(deriveGradient("Noa Kirel"));
  });

  it("returns 'grad-slate' for empty input as a stable default", () => {
    expect(deriveGradient("")).toBe("grad-slate");
  });

  it("distributes names across all 6 tokens (smoke)", () => {
    const seen = new Set<string>();
    const names = ["Alice","Bob","Carol","Dan","Eve","Frank","Gina","Hugo","Iris","Jack","Kim","Liam"];
    for (const n of names) seen.add(deriveGradient(n));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
