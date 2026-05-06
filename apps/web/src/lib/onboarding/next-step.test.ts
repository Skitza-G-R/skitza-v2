import { describe, expect, it } from "vitest";

import { nextStepFor } from "./next-step";

// T8 — pin the wizard's forward-step routing for the 6-step flow.
//
// Each step page also exports a `nextRouteAfter*` helper of its own;
// this central helper aliases the same destinations so a future tooling
// surface (Setup-nudge deep-link, "skip remaining" admin action) has a
// single source of truth without depending on per-page modules.

describe("nextStepFor (forward-step routing for the 6-step wizard)", () => {
  it("studio → /onboarding/services (Step 1 → Step 2)", () => {
    expect(nextStepFor("studio")).toBe("/onboarding/services");
  });

  it("services → /onboarding/service (Step 2 → Step 3)", () => {
    expect(nextStepFor("services")).toBe("/onboarding/service");
  });

  it("service → /onboarding/availability (Step 3 → Step 4)", () => {
    expect(nextStepFor("service")).toBe("/onboarding/availability");
  });

  it("availability → /onboarding/payment (Step 4 → Step 5)", () => {
    expect(nextStepFor("availability")).toBe("/onboarding/payment");
  });

  it("payment → /onboarding/portfolio (Step 5 → Step 6)", () => {
    expect(nextStepFor("payment")).toBe("/onboarding/portfolio");
  });

  it("portfolio → /onboarding/complete (Step 6 → completion screen)", () => {
    expect(nextStepFor("portfolio")).toBe("/onboarding/complete");
  });

  it("complete → /dashboard (terminal exit when producer clicks the CTA)", () => {
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
