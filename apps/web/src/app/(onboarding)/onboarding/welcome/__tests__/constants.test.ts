import { describe, expect, it } from "vitest";

import { nextRouteAfterWelcome } from "../constants";

// Step 0 — Welcome screen.
//
// Welcome is the new entry to the wizard introduced by the May 2026
// redesign. It sits BEFORE Step 1 (studio) and is not counted in the
// shell's "Step N of 6" numbering — it's a context-set screen, not a
// data-capture step. Tapping the "Start setting up" CTA advances the
// producer to Step 1 (/onboarding/studio).

describe("welcome constants — Step 0 of the producer onboarding wizard", () => {
  it('"Start setting up" CTA routes to /onboarding/studio (Step 1)', () => {
    expect(nextRouteAfterWelcome()).toBe("/onboarding/studio");
  });
});
