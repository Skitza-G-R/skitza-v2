import { describe, expect, it } from "vitest";

import {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_TITLE,
  SERVICE_STEP_SUBTITLE,
  nextRouteAfterService,
  routeOnSkipFromService,
  ONBOARDING_STEP_NAME,
} from "../page";

// Story 04 — Step 2 page contract. The repo runs vitest in `node` env
// (no jsdom), so we don't render JSX. Instead the page module exports
// a handful of pure constants + helpers and we pin them here. This is
// the same pattern Story 03 used for the studio page (precedent at
// __tests__/page.test.tsx beside the studio page).
//
// What this file pins:
//   - SERVICE_STEP_INDEX === 2 (shell renders Step 2 of 4)
//   - SERVICE_STEP_TITLE === "Add your first service." (acceptance criteria)
//   - subtitle copy stays welcoming (substring assertion only — copy can
//     evolve word-by-word, but a future move to lawyerly tone breaks here)
//   - nextRouteAfterService → "/onboarding/availability" (Step 3 path)
//   - routeOnSkipFromService → "/onboarding/availability" (Skip ghost
//     advances without saving — same destination, different telemetry)
//   - ONBOARDING_STEP_NAME === "service" (used to call decideOnboardingRedirect
//     with the correct OnboardingStep tag at the page-level role guard)

describe("Step 2 (service) page contract", () => {
  describe("constants", () => {
    it("renders as Step 2 of the 4-step shell", () => {
      expect(SERVICE_STEP_INDEX).toBe(2);
    });

    it("uses the architecture-mandated title 'Add your first service.'", () => {
      expect(SERVICE_STEP_TITLE).toBe("Add your first service.");
    });

    it("subtitle stays welcoming (mentions reversibility / freedom to skip)", () => {
      // Pin a substring that proves the subtitle reassures rather than
      // demands. If a future copy edit goes formal/legalese, this test
      // fails and forces a deliberate update.
      expect(SERVICE_STEP_SUBTITLE.toLowerCase()).toMatch(/later|skip|change|edit/);
    });

    it("step-name tag matches the OnboardingStep used in decide-redirect", () => {
      // The server-component layer calls decideOnboardingRedirect(role,
      // ONBOARDING_STEP_NAME). Pinning the literal here prevents the
      // page from drifting from the routing matrix (e.g. someone passing
      // "services" by accident — extra 's' — would silently bypass the
      // step-aware redirect and fall back to default "studio").
      expect(ONBOARDING_STEP_NAME).toBe("service");
    });
  });

  describe("nextRouteAfterService (form-success advance)", () => {
    it("routes to Step 3 (/onboarding/availability) after createPackage succeeds", () => {
      // NewPackageForm calls onClose() after a successful create. The
      // service page hijacks that callback to push to the next step.
      // Pin the target path so a typo is caught at test time, not at
      // user time.
      expect(nextRouteAfterService()).toBe("/onboarding/availability");
    });
  });

  describe("routeOnSkipFromService (Skip ghost link)", () => {
    it("advances to /onboarding/availability without saving", () => {
      // Skip is the Step 2 escape hatch. Acceptance criteria explicitly
      // says it must go to /onboarding/availability (NOT /dashboard) —
      // the producer can still complete Steps 3-4 even without a service.
      expect(routeOnSkipFromService()).toBe("/onboarding/availability");
    });

    it("targets the same destination as the form-success route (one path forward)", () => {
      // This invariant is load-bearing: if Skip and Continue diverged,
      // the wizard would branch and require a state machine. Keeping
      // them aligned means the only difference is "did createPackage
      // run?" — telemetry handles the distinction (step_completed vs
      // step_skipped), not the navigation.
      expect(routeOnSkipFromService()).toBe(nextRouteAfterService());
    });
  });
});
