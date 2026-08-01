import { describe, expect, it } from "vitest";

import { WIZARD_STEPS, getStepByPosition, getStepById } from "./wizard-steps";

// WIZARD_STEPS is the single-source-of-truth for the 5 numbered steps
// shown in the producer setup rail. The first item is deliberately
// already complete when onboarding opens: the signed-in producer has
// genuinely created an account.
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
    expect(ids).toEqual(["account", "identity", "product", "availability", "publish"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("shows a true completed win before the first editable step", () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      "Account created",
      "Public page",
      "First product",
      "Working hours",
      "Review & publish",
    ]);
    expect(WIZARD_STEPS[0]).toMatchObject({
      state: "complete",
      meta: "Done",
      route: null,
    });
  });

  it("keeps optional portfolio and payment details outside numbered progress", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).not.toContain("portfolio");
    expect(WIZARD_STEPS.map((s) => s.id)).not.toContain("payment");
  });

  it("routes editable steps into the canonical onboarding family", () => {
    expect(WIZARD_STEPS.map((s) => s.route)).toEqual([
      null,
      "/onboarding/studio",
      "/onboarding/service",
      "/onboarding/availability",
      "/onboarding/review",
    ]);
  });
});

describe("getStepByPosition", () => {
  it("returns the step at that 1-indexed position", () => {
    expect(getStepByPosition(1)?.id).toBe("account");
    expect(getStepByPosition(3)?.id).toBe("product");
    expect(getStepByPosition(5)?.id).toBe("publish");
  });

  it("returns undefined for out-of-range positions", () => {
    expect(getStepByPosition(0)).toBeUndefined();
    expect(getStepByPosition(6)).toBeUndefined();
    expect(getStepByPosition(-1)).toBeUndefined();
  });
});

describe("getStepById", () => {
  it("returns the step with that id", () => {
    expect(getStepById("identity")?.position).toBe(2);
    expect(getStepById("availability")?.position).toBe(4);
  });

  it("returns undefined for unknown ids", () => {
    expect(getStepById("studio")).toBeUndefined();
    expect(getStepById("done")).toBeUndefined();
    expect(getStepById("portfolio")).toBeUndefined();
  });
});
