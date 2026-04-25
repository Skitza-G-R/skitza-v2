import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_TITLE,
  AVAILABILITY_STEP_SUBTITLE,
  ONBOARDING_STEP_NAME,
  AVAILABILITY_CONTINUE_ALWAYS_ENABLED,
  nextRouteAfterAvailability,
  routeOnSkipFromAvailability,
  routeOnBackFromAvailability,
} from "../page";

// Story 05 — Step 3 (availability) page contract. Mirrors the
// constants-and-helpers-only test pattern Stories 03 + 04 used (the
// repo runs vitest in `node` env — no jsdom — so we don't render JSX).
//
// What this file pins:
//   - AVAILABILITY_STEP_INDEX === 3 (shell renders Step 3 of 4)
//   - AVAILABILITY_STEP_TITLE === "When are you open?" (acceptance
//     criteria #1 + architecture §6)
//   - subtitle copy stays welcoming (substring assertion only)
//   - ONBOARDING_STEP_NAME === "availability" — the OnboardingStep tag
//     passed to decideOnboardingRedirect at the page-level role guard.
//     A typo (e.g. "available") would silently fall back to the
//     default-arg "studio" branch and bounce mid-flow producers out of
//     Step 3 — pinning the literal here catches that at test time.
//   - Continue is always enabled (acceptance criteria #7) — the 5
//     children auto-save on change so the producer can advance with
//     whatever they've configured. Encoded as a boolean constant so
//     the invariant lives in one place + is pinned by the test.
//   - nextRouteAfterAvailability → "/onboarding/portfolio" (Step 4)
//   - routeOnSkipFromAvailability → "/onboarding/portfolio" — same
//     destination as Continue (Skip and Continue both forward; the
//     distinction is telemetry-only, not routing).
//   - routeOnBackFromAvailability → "/onboarding/service" (back to
//     Step 2) so the action bar's Back button hops one step.

describe("Step 3 (availability) page contract", () => {
  describe("constants", () => {
    it("renders as Step 3 of the 4-step shell", () => {
      expect(AVAILABILITY_STEP_INDEX).toBe(3);
    });

    it("uses the architecture-mandated title 'When are you open?'", () => {
      expect(AVAILABILITY_STEP_TITLE).toBe("When are you open?");
    });

    it("subtitle stays welcoming (mentions reversibility / freedom to skip)", () => {
      // Pin a substring that proves the subtitle reassures rather than
      // demands. If a future copy edit goes formal/legalese, this test
      // fails and forces a deliberate update.
      expect(AVAILABILITY_STEP_SUBTITLE.toLowerCase()).toMatch(
        /later|skip|change|edit|adjust/,
      );
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      // The server-component role guard (in page.tsx default export)
      // calls decideOnboardingRedirect(role, ONBOARDING_STEP_NAME).
      // Pinning the literal here prevents a typo (e.g. "available")
      // from silently bypassing the step-aware redirect.
      expect(ONBOARDING_STEP_NAME).toBe("availability");
    });

    it("Continue is always enabled (acceptance criteria #7 — children auto-save)", () => {
      // The 5 child editors (GCal stub, duration picker, policies,
      // weekly windows, blackouts) each handle their own writes via
      // existing tRPC mutations. The producer can advance with whatever
      // they've set — including nothing. Pinning the invariant as a
      // boolean here catches a regression where someone gates Continue
      // on "blocks.length > 0" or similar.
      expect(AVAILABILITY_CONTINUE_ALWAYS_ENABLED).toBe(true);
    });
  });

  describe("nextRouteAfterAvailability (Continue advance)", () => {
    it("routes to Step 4 (/onboarding/portfolio)", () => {
      // Continue forwards to /onboarding/portfolio. Pin the target so
      // a typo (e.g. "/onboarding/portolio") is caught at test time,
      // not at user time.
      expect(nextRouteAfterAvailability()).toBe("/onboarding/portfolio");
    });
  });

  describe("routeOnSkipFromAvailability (Skip ghost link)", () => {
    it("advances to /onboarding/portfolio without saving", () => {
      // Skip is the Step 3 escape hatch. Acceptance criteria says it
      // must go to /onboarding/portfolio. The producer can still
      // complete Step 4 even without configuring availability.
      expect(routeOnSkipFromAvailability()).toBe("/onboarding/portfolio");
    });

    it("targets the same destination as the Continue route (one path forward)", () => {
      // This invariant is load-bearing: if Skip and Continue diverged
      // the wizard would branch. Keeping them aligned means the only
      // difference is telemetry (step_completed vs step_skipped), not
      // navigation.
      expect(routeOnSkipFromAvailability()).toBe(nextRouteAfterAvailability());
    });
  });

  describe("routeOnBackFromAvailability (Back button)", () => {
    it("returns to Step 2 (/onboarding/service)", () => {
      // Back hops one step. The wizard is a strict 4-step linear flow;
      // Back from Step 3 lands on Step 2 (service). Pin the literal so
      // an off-by-one (e.g. /onboarding/studio) is caught at test time.
      expect(routeOnBackFromAvailability()).toBe("/onboarding/service");
    });
  });
});
