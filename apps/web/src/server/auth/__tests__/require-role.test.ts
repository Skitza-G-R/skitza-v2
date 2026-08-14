import { describe, it, expect } from "vitest";
import {
  decideAccountMembershipRedirect,
  decideRoleRedirect,
  type ProducerRow,
  type UserAccountMemberships,
  type UserRole,
} from "../role";

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

  it("orphan → /producer-access", () => {
    expect(decideRoleRedirect(orphan, "producer")).toBe("/producer-access");
  });

  it("producer-complete → null (render)", () => {
    expect(decideRoleRedirect(proComplete, "producer")).toBeNull();
  });
});

describe("decideRoleRedirect — artist policy", () => {
  it("unauthenticated → /sign-in?redirect_url=/artist", () => {
    expect(decideRoleRedirect(unauth, "artist")).toBe("/sign-in?redirect_url=/artist");
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

  it("orphan → /producer-access (the account has no Artist role)", () => {
    // /artist-welcome would be wrong: it needs an Artist identity and
    // studio context that a no-role account does not have.
    expect(decideRoleRedirect(orphan, "artist")).toBe("/producer-access");
  });

  it("artist → null (render)", () => {
    expect(decideRoleRedirect(artist, "artist")).toBeNull();
  });
});

describe("decideAccountMembershipRedirect", () => {
  it("blocks normal app routes once a verified closure starts", () => {
    const closing: UserAccountMemberships = {
      isAuthenticated: true,
      accountStatus: "closure_started",
      producer: { status: "complete", profile: completeProducer },
      artist: { hasAccess: true, hasActiveConnections: true },
    };

    expect(decideAccountMembershipRedirect(closing, "producer")).toBe("/account-closed");
    expect(decideAccountMembershipRedirect(closing, "artist")).toBe("/account-closed");
  });

  it("allows a dual-role account through either route family", () => {
    const dual: UserAccountMemberships = {
      isAuthenticated: true,
      producer: { status: "complete", profile: completeProducer },
      artist: { hasAccess: true, hasActiveConnections: true },
    };

    expect(decideAccountMembershipRedirect(dual, "producer")).toBeNull();
    expect(decideAccountMembershipRedirect(dual, "artist")).toBeNull();
  });

  it("allows a disconnected artist account into the empty artist platform", () => {
    const disconnectedArtist: UserAccountMemberships = {
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: false },
    };

    expect(decideAccountMembershipRedirect(disconnectedArtist, "artist")).toBeNull();
  });

  it("preserves strict rejection for a producer without artist membership", () => {
    const producerOnlyMemberships: UserAccountMemberships = {
      isAuthenticated: true,
      producer: { status: "complete", profile: completeProducer },
      artist: { hasAccess: false, hasActiveConnections: false },
    };

    expect(decideAccountMembershipRedirect(producerOnlyMemberships, "artist")).toBe("/dashboard");
  });

  it("allows artist access while keeping an incomplete producer in onboarding", () => {
    const incompleteDual: UserAccountMemberships = {
      isAuthenticated: true,
      producer: { status: "incomplete", profile: incompleteProducer },
      artist: { hasAccess: true, hasActiveConnections: true },
    };

    expect(decideAccountMembershipRedirect(incompleteDual, "artist")).toBeNull();
    expect(decideAccountMembershipRedirect(incompleteDual, "producer")).toBe("/onboarding");
  });

  it("redirects a signed-in account without any role to Producer invitation information", () => {
    const noRole: UserAccountMemberships = {
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: false, hasActiveConnections: false },
    };

    expect(decideAccountMembershipRedirect(noRole, "producer")).toBe("/producer-access");
    expect(decideAccountMembershipRedirect(noRole, "artist")).toBe("/producer-access");
  });
});
