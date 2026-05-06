import { describe, it, expect } from "vitest";
import { decideOnboardingRedirect, stepFromPath } from "../decide-redirect";
import type { UserRole, ProducerRow } from "~/server/auth/role";

// Routing policy for the /onboarding producer wizard — added as part
// of audit Task 16 (strict role isolation).
//
// Before this fix, (onboarding)/layout.tsx ran no role check — so an
// artist typing /onboarding directly bypassed the (app)/layout gate
// and landed on the producer onboarding wizard. This file pins the
// correct mapping from UserRole → redirect target.
//
// Story 04 (2026-04-25) extended the signature to be step-aware. Old
// callers that don't pass `currentStep` continue to work identically
// — the default arg is "studio", so single-arg calls preserve the
// original 5-case truth table verbatim. The new step-aware behaviour
// is exercised by the matrix at the bottom of this file.

const completeProducer: ProducerRow = {
  id: "producer-complete",
  displayName: "Gili Asraf",
  slug: "gili-asraf",
  email: "gili@x.com",
};

const incompleteProducer: ProducerRow = {
  id: "producer-incomplete",
  displayName: null,
  slug: "auto-slug",
  email: "pat@x.com",
};

describe("decideOnboardingRedirect (1-arg, default currentStep='studio')", () => {
  it("redirects unauthenticated → /sign-in", () => {
    const role: UserRole = { kind: "unauthenticated" };
    expect(decideOnboardingRedirect(role)).toBe("/sign-in");
  });

  it("🔴 TASK 16 CORE: redirects artist → /artist (hard wall)", () => {
    // The critical regression guard. An artist typing /onboarding
    // directly MUST be bounced to their artist home, not allowed to
    // see the producer wizard.
    const role: UserRole = { kind: "artist" };
    expect(decideOnboardingRedirect(role)).toBe("/artist");
  });

  it("redirects producer-complete → /dashboard (answer to Q1: fully-onboarded producers have no business here)", () => {
    const role: UserRole = { kind: "producer-complete", producer: completeProducer };
    expect(decideOnboardingRedirect(role)).toBe("/dashboard");
  });

  it("allows render (returns null) for producer-incomplete (normal first-run case)", () => {
    const role: UserRole = { kind: "producer-incomplete", producer: incompleteProducer };
    expect(decideOnboardingRedirect(role)).toBeNull();
  });

  it("allows render for orphan (Clerk webhook race — form's upsert handles it idempotently)", () => {
    const role: UserRole = { kind: "orphan" };
    expect(decideOnboardingRedirect(role)).toBeNull();
  });
});

// Story 04 — step-aware extension.
//
// The wizard now lives at four URLs (/onboarding/{studio,service,
// availability,portfolio}). A producer who has completed Step 1 is
// `producer-complete` (slug + display name set), but they're still
// mid-flow on Steps 2-4 in the same session — so the redirect rule
// for "complete" must depend on which step they're hitting:
//
//   • on /onboarding/studio  → /dashboard (don't re-do Step 1)
//   • on /onboarding/{2,3,4} → null (let them finish the wizard)
//
// And inverted for incomplete users: hitting any non-studio URL means
// they tried to deep-link past Step 1 — bounce them back to studio so
// the slug + display name are captured first.
//
//   • producer-incomplete or orphan on /onboarding/studio → null (render)
//   • producer-incomplete or orphan on /onboarding/{2,3,4} → /onboarding/studio
//
// Artist + unauthenticated rules don't depend on step — the role wall
// fires the same redirect for every URL inside (onboarding).
describe("decideOnboardingRedirect (2-arg, step-aware)", () => {
  describe("producer-complete on non-studio steps (renders, mid-flow)", () => {
    const role: UserRole = { kind: "producer-complete", producer: completeProducer };

    it("returns null on /onboarding/service (Step 2)", () => {
      expect(decideOnboardingRedirect(role, "service")).toBeNull();
    });

    it("returns null on /onboarding/availability (Step 3)", () => {
      expect(decideOnboardingRedirect(role, "availability")).toBeNull();
    });

    it("returns null on /onboarding/portfolio (Step 4)", () => {
      expect(decideOnboardingRedirect(role, "portfolio")).toBeNull();
    });

    it("still redirects to /dashboard on /onboarding/studio (no Step-1 loop)", () => {
      expect(decideOnboardingRedirect(role, "studio")).toBe("/dashboard");
    });
  });

  describe("producer-incomplete on non-studio steps (must do Step 1 first)", () => {
    const role: UserRole = { kind: "producer-incomplete", producer: incompleteProducer };

    it("redirects /onboarding/service → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "service")).toBe("/onboarding/studio");
    });

    it("redirects /onboarding/availability → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "availability")).toBe("/onboarding/studio");
    });

    it("redirects /onboarding/portfolio → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "portfolio")).toBe("/onboarding/studio");
    });

    it("still allows render on /onboarding/studio (Step 1 itself)", () => {
      expect(decideOnboardingRedirect(role, "studio")).toBeNull();
    });
  });

  describe("orphan on non-studio steps (treat like producer-incomplete)", () => {
    const role: UserRole = { kind: "orphan" };

    it("redirects /onboarding/service → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "service")).toBe("/onboarding/studio");
    });

    it("redirects /onboarding/availability → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "availability")).toBe("/onboarding/studio");
    });

    it("redirects /onboarding/portfolio → /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "portfolio")).toBe("/onboarding/studio");
    });

    it("still allows render on /onboarding/studio", () => {
      expect(decideOnboardingRedirect(role, "studio")).toBeNull();
    });
  });

  describe("role wall is step-agnostic (artist + unauth)", () => {
    it("artist always redirects to /artist regardless of step", () => {
      const role: UserRole = { kind: "artist" };
      expect(decideOnboardingRedirect(role, "studio")).toBe("/artist");
      expect(decideOnboardingRedirect(role, "service")).toBe("/artist");
      expect(decideOnboardingRedirect(role, "availability")).toBe("/artist");
      expect(decideOnboardingRedirect(role, "portfolio")).toBe("/artist");
    });

    it("unauthenticated always redirects to /sign-in regardless of step", () => {
      const role: UserRole = { kind: "unauthenticated" };
      expect(decideOnboardingRedirect(role, "studio")).toBe("/sign-in");
      expect(decideOnboardingRedirect(role, "service")).toBe("/sign-in");
      expect(decideOnboardingRedirect(role, "availability")).toBe("/sign-in");
      expect(decideOnboardingRedirect(role, "portfolio")).toBe("/sign-in");
    });
  });
});

// stepFromPath — pure helper used by the layout to translate the
// `x-pathname` request header (forwarded by middleware) into an
// OnboardingStep tag. Decoupled from the layout so the mapping is
// testable without simulating Next.js's request context.
describe("stepFromPath", () => {
  it("maps each step URL to its tag (T8 — 6 step + completion)", () => {
    expect(stepFromPath("/onboarding/studio")).toBe("studio");
    expect(stepFromPath("/onboarding/services")).toBe("services");
    expect(stepFromPath("/onboarding/service")).toBe("service");
    expect(stepFromPath("/onboarding/availability")).toBe("availability");
    expect(stepFromPath("/onboarding/payment")).toBe("payment");
    expect(stepFromPath("/onboarding/portfolio")).toBe("portfolio");
    expect(stepFromPath("/onboarding/complete")).toBe("complete");
  });

  it("matches services BEFORE service (prefix-collision discipline)", () => {
    // /onboarding/service does NOT start with /onboarding/services
    // (extra 's'), so the lookup correctly resolves to "service" even
    // though "services" comes first in STEP_NAMES. The reverse path
    // /onboarding/services prefix-matches "services" and short-circuits
    // before reaching "service".
    expect(stepFromPath("/onboarding/services")).toBe("services");
    expect(stepFromPath("/onboarding/service")).toBe("service");
  });

  it("matches with starts-with so trailing slashes / nested paths still work", () => {
    expect(stepFromPath("/onboarding/service/")).toBe("service");
    expect(stepFromPath("/onboarding/portfolio?welcome=1")).toBe("portfolio");
    expect(stepFromPath("/onboarding/complete?utm=x")).toBe("complete");
  });

  it("falls back to 'studio' for the bare /onboarding index (which redirects to studio anyway)", () => {
    expect(stepFromPath("/onboarding")).toBe("studio");
  });

  it("falls back to 'studio' for unknown / unrelated paths", () => {
    expect(stepFromPath("/dashboard")).toBe("studio");
    expect(stepFromPath("/some-other-page")).toBe("studio");
  });

  it("falls back to 'studio' when the header is missing (null / undefined / empty)", () => {
    expect(stepFromPath(null)).toBe("studio");
    expect(stepFromPath(undefined)).toBe("studio");
    expect(stepFromPath("")).toBe("studio");
  });

  it("prefix-matches the longer step name first (services-listing → services)", () => {
    // Defensive: a hypothetical /onboarding/services-listing route
    // starts with "/onboarding/services" so the lookup resolves to
    // "services". Pin it explicitly so a future refactor (e.g.
    // exact-match dispatch) updates the test deliberately rather than
    // silently breaking the redirect.
    expect(stepFromPath("/onboarding/services-listing")).toBe("services");
  });
});
