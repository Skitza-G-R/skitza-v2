import { describe, it, expect } from "vitest";
import { decideOnboardingRedirect } from "../decide-redirect";
import type { UserRole, ProducerRow } from "~/server/auth/role";

// Routing policy for the /onboarding producer wizard — added as part
// of audit Task 16 (strict role isolation).
//
// Before this fix, (onboarding)/layout.tsx ran no role check — so an
// artist typing /onboarding directly bypassed the (app)/layout gate
// and landed on the producer onboarding wizard. This file pins the
// correct mapping from UserRole → redirect target.

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

describe("decideOnboardingRedirect", () => {
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
