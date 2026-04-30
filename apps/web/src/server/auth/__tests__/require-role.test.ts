import { describe, it, expect } from "vitest";
import { decideRoleRedirect, type ProducerRow, type UserRole } from "../role";

// Tests for the kind→redirect mapping that requireRole() enforces at
// the top of every protected layout. Replaces the redirect-string
// assertions previously in (producer)/__tests__/decide-redirect.test.ts;
// the role-classification assertions live in role.test.ts.
//
// Two policies, kept symmetric:
//   - producer: only producer-complete passes
//   - artist:   only artist passes (producer-complete bounces to
//               /dashboard per CLAUDE.md role isolation)

const completeProducer: ProducerRow = {
  id: "producer-1",
  displayName: "Gili Asraf",
  slug: "gili-asraf",
  email: "gili@x.com",
};

const incompleteProducer: ProducerRow = {
  id: "producer-2",
  displayName: null,
  slug: "set-custom-slug",
  email: "someone@x.com",
};

const unauth: UserRole = { kind: "unauthenticated" };
const artist: UserRole = { kind: "artist" };
const orphan: UserRole = { kind: "orphan" };
const proIncomplete: UserRole = {
  kind: "producer-incomplete",
  producer: incompleteProducer,
};
const proComplete: UserRole = {
  kind: "producer-complete",
  producer: completeProducer,
};

describe("decideRoleRedirect — producer policy", () => {
  it("unauthenticated → /sign-in", () => {
    expect(decideRoleRedirect(unauth, "producer")).toBe("/sign-in");
  });

  it("artist → /artist", () => {
    expect(decideRoleRedirect(artist, "producer")).toBe("/artist");
  });

  it("producer-incomplete → /onboarding", () => {
    expect(decideRoleRedirect(proIncomplete, "producer")).toBe("/onboarding");
  });

  it("orphan → /onboarding (webhook race; wizard waits idempotently)", () => {
    expect(decideRoleRedirect(orphan, "producer")).toBe("/onboarding");
  });

  it("producer-complete → null (render)", () => {
    expect(decideRoleRedirect(proComplete, "producer")).toBeNull();
  });
});

describe("decideRoleRedirect — artist policy", () => {
  it("unauthenticated → /sign-in?redirect_url=/artist", () => {
    expect(decideRoleRedirect(unauth, "artist")).toBe(
      "/sign-in?redirect_url=/artist",
    );
  });

  it("producer-complete → /dashboard (CLAUDE.md: producer cannot reach /artist/*)", () => {
    // Bug-fix regression guard: before P2-A-6 the artist layout
    // allowed any user with a producers row through (with isProducer
    // chrome). CLAUDE.md is explicit that v1 is one active role at a
    // time, so producers bounce to their own dashboard.
    expect(decideRoleRedirect(proComplete, "artist")).toBe("/dashboard");
  });

  it("producer-incomplete → /onboarding (finish producer wizard first)", () => {
    expect(decideRoleRedirect(proIncomplete, "artist")).toBe("/onboarding");
  });

  it("orphan → /sign-in (no DB identity yet; re-trigger resolution)", () => {
    // Orphan = authed Clerk session but neither producers nor
    // client_contacts row. /artist-welcome would be wrong: it needs
    // studio context an orphan doesn't have. /sign-in re-runs the
    // identity flow once the webhook lands.
    expect(decideRoleRedirect(orphan, "artist")).toBe("/sign-in");
  });

  it("artist → null (render)", () => {
    expect(decideRoleRedirect(artist, "artist")).toBeNull();
  });
});
