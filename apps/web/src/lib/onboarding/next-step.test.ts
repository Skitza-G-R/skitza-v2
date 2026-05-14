import { describe, expect, it } from "vitest";

import { nextStepFor } from "./next-step";

// May 2026 redesign — pin the wizard's forward-step routing.
//
// Flow (5 captures + completion screen, plus a back-compat hop for
// the dropped /services chip step):
//
//   studio       → /onboarding/service        (Step 1 → Step 2)
//   services     → /onboarding/service        (legacy back-compat)
//   service      → /onboarding/availability   (Step 2 → Step 3)
//   availability → /onboarding/portfolio      (Step 3 → Step 4)
//   portfolio    → /onboarding/payment        (Step 4 → Step 5)
//   payment      → /onboarding/complete       (Step 5 → celebration)
//   complete     → /dashboard                 (terminal exit)

describe("nextStepFor (forward-step routing for the redesigned wizard)", () => {
  it("studio → /onboarding/service (Step 1 → Step 2; bypasses dropped /services)", () => {
    expect(nextStepFor("studio")).toBe("/onboarding/service");
  });

  it("services → /onboarding/service (legacy back-compat hop)", () => {
    expect(nextStepFor("services")).toBe("/onboarding/service");
  });

  it("service → /onboarding/availability (Step 2 → Step 3)", () => {
    expect(nextStepFor("service")).toBe("/onboarding/availability");
  });

  it("availability → /onboarding/portfolio (Step 3 → Step 4)", () => {
    expect(nextStepFor("availability")).toBe("/onboarding/portfolio");
  });

  it("portfolio → /onboarding/payment (Step 4 → Step 5; redesign reorders portfolio first)", () => {
    expect(nextStepFor("portfolio")).toBe("/onboarding/payment");
  });

  it("payment → /onboarding/complete (Step 5 → celebration)", () => {
    expect(nextStepFor("payment")).toBe("/onboarding/complete");
  });

  it("complete → /dashboard (terminal exit when producer clicks Open dashboard)", () => {
    expect(nextStepFor("complete")).toBe("/dashboard");
  });

  it("never returns undefined / null (every step has a defined next)", () => {
    const steps = [
      "studio",
      "services",
      "service",
      "availability",
      "payment",
      "portfolio",
      "complete",
    ] as const;
    for (const s of steps) {
      expect(nextStepFor(s)).toBeTruthy();
    }
  });
});
