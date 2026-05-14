import { describe, expect, it } from "vitest";

import { WIZARD_STEPS, getStepByPosition, getStepById } from "./wizard-steps";

// WIZARD_STEPS is the single-source-of-truth for the 5 numbered steps
// shown in the desktop rail (Step 1..Step 5). Welcome (Step 0) and
// Done (post-Step 5) are NOT in this list — they don't appear in the
// rail and have separate UI shells.
//
// Order, labels, meta strings, and required flags are pinned by tests
// because they're load-bearing for the visual rail (positions drive
// which row gets the active highlight, required vs optional drives
// the meta line + Skip button visibility on the step pages).

describe("WIZARD_STEPS — the 5-step rail data structure", () => {
  it("has exactly 5 steps (1..5)", () => {
    expect(WIZARD_STEPS).toHaveLength(5);
  });

  it("positions are 1..5 in order", () => {
    expect(WIZARD_STEPS.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ids are stable + unique (id determines route + state)", () => {
    const ids = WIZARD_STEPS.map((s) => s.id);
    expect(ids).toEqual(["studio", "service", "availability", "portfolio", "payment"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("matches redesign labels (rail row text)", () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      "Your hall",
      "First service",
      "When you work",
      "A taste",
      "Get paid",
    ]);
  });

  it("matches redesign required/optional split (1-3 required, 4-5 optional)", () => {
    expect(WIZARD_STEPS.map((s) => s.required)).toEqual([true, true, true, false, false]);
  });

  it("meta string format: '{Required|Optional} · {n}s'", () => {
    for (const step of WIZARD_STEPS) {
      const expectedPrefix = step.required ? "Required" : "Optional";
      expect(step.meta).toMatch(new RegExp(`^${expectedPrefix} · \\d+s$`));
    }
  });

  it("routes match the existing /onboarding/{id} URLs (Step 1 → /onboarding/studio etc.)", () => {
    expect(WIZARD_STEPS.map((s) => s.route)).toEqual([
      "/onboarding/studio",
      "/onboarding/service",
      "/onboarding/availability",
      "/onboarding/portfolio",
      "/onboarding/payment",
    ]);
  });
});

describe("getStepByPosition", () => {
  it("returns the step at that 1-indexed position", () => {
    expect(getStepByPosition(1)?.id).toBe("studio");
    expect(getStepByPosition(3)?.id).toBe("availability");
    expect(getStepByPosition(5)?.id).toBe("payment");
  });

  it("returns undefined for out-of-range positions", () => {
    expect(getStepByPosition(0)).toBeUndefined();
    expect(getStepByPosition(6)).toBeUndefined();
    expect(getStepByPosition(-1)).toBeUndefined();
  });
});

describe("getStepById", () => {
  it("returns the step with that id", () => {
    expect(getStepById("studio")?.position).toBe(1);
    expect(getStepById("portfolio")?.position).toBe(4);
  });

  it("returns undefined for unknown ids", () => {
    expect(getStepById("welcome")).toBeUndefined();
    expect(getStepById("done")).toBeUndefined();
    expect(getStepById("services")).toBeUndefined(); // legacy chip step (dropped)
  });
});
