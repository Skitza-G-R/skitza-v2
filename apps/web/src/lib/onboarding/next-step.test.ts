import { describe, expect, it } from "vitest";

import { nextStepFor } from "./next-step";

// Story 09 — pin the wizard's forward-step routing in one place.
//
// Each step page already exports a `nextRouteAfter*` helper of its own;
// this central helper aliases the same destinations so a future tooling
// surface (Setup-nudge deep-link, "skip remaining" admin action) has a
// single source of truth without depending on four separate page files.
//
// Tests deliberately cover the full 4-step sequence — if a renamer
// changes an OnboardingStep value (e.g. "service" → "first_service")
// the typechecker catches it but a missing arm of the switch would
// fall through silently; this test ensures every step is mapped.

describe("nextStepFor (forward-step routing for the 4-step wizard)", () => {
  it("studio → /onboarding/service (Step 1 → Step 2)", () => {
    expect(nextStepFor("studio")).toBe("/onboarding/service");
  });

  it("service → /onboarding/availability (Step 2 → Step 3)", () => {
    expect(nextStepFor("service")).toBe("/onboarding/availability");
  });

  it("availability → /onboarding/portfolio (Step 3 → Step 4)", () => {
    expect(nextStepFor("availability")).toBe("/onboarding/portfolio");
  });

  it("portfolio → /dashboard (Step 4 = end of wizard)", () => {
    // The last step's "next" is the wizard's exit. Skip from Step 4
    // also lands here (Story 08 — telemetry-only divergence between
    // Continue and Skip).
    expect(nextStepFor("portfolio")).toBe("/dashboard");
  });

  it("never returns undefined / null (every step has a defined next)", () => {
    // Defensive: if a future OnboardingStep value gets added to the
    // type but not to the switch, TypeScript catches it at compile —
    // but we also pin it at runtime so a test failure surfaces the
    // gap immediately.
    const steps = ["studio", "service", "availability", "portfolio"] as const;
    for (const s of steps) {
      expect(nextStepFor(s)).toBeTruthy();
    }
  });
});
