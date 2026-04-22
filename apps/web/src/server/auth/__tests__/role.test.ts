import { describe, it, expect } from "vitest";
import { resolveUserRole, type ProducerRow } from "../role";
import { emailToSlug } from "~/lib/slug";

// Tests for the pure role-resolution function used across every
// producer-only layout + server action to enforce the role boundary
// introduced by audit Task 16.
//
// Roles:
//   - "unauthenticated": no Clerk user id
//   - "artist": no producer row but has client_contacts
//   - "producer-incomplete": producer row exists but displayName is
//     null or slug is still the auto-generated email-derived default
//   - "producer-complete": producer row with displayName + custom slug
//   - "orphan": authenticated but no producer row AND no
//     client_contacts — typically a sub-second window during the
//     Clerk webhook race, or a webhook delivery failure

const completeProducer: ProducerRow = {
  id: "producer-1",
  displayName: "Gili Asraf",
  slug: "gili-asraf",
  email: "gili@x.com",
};

const autoSlugProducer: ProducerRow = {
  id: "producer-2",
  displayName: "Pat Producer",
  // auto-slug pattern: <local-part>-<4char-hash>. The "user.com" email
  // produces a predictable auto-slug we can match with isAutoSlug.
  slug: emailToSlug("pat@producer.com"),
  email: "pat@producer.com",
};

const nullNameProducer: ProducerRow = {
  id: "producer-3",
  displayName: null,
  slug: "set-custom-slug",
  email: "someone@x.com",
};

describe("resolveUserRole", () => {
  it("returns 'unauthenticated' when userId is null", () => {
    const role = resolveUserRole({
      userId: null,
      producerRow: null,
      hasClientContacts: false,
    });
    expect(role.kind).toBe("unauthenticated");
  });

  it("returns 'artist' when user has client_contacts but no producer row", () => {
    // THE critical case for Task 16: artists who self-served via
    // /join/<slug>. The onboarding layout + completeOnboarding action
    // must use this signal to reject them.
    const role = resolveUserRole({
      userId: "user_artist",
      producerRow: null,
      hasClientContacts: true,
    });
    expect(role.kind).toBe("artist");
  });

  it("returns 'producer-incomplete' when producer row exists with null displayName", () => {
    const role = resolveUserRole({
      userId: "user_pro",
      producerRow: nullNameProducer,
      hasClientContacts: false,
    });
    expect(role.kind).toBe("producer-incomplete");
    if (role.kind === "producer-incomplete") {
      expect(role.producer.id).toBe("producer-3");
    }
  });

  it("returns 'producer-incomplete' when slug is still the email-derived auto-slug", () => {
    // A producer can set their display name but forget the slug —
    // still incomplete, still funnels to the wizard.
    const role = resolveUserRole({
      userId: "user_pro",
      producerRow: autoSlugProducer,
      hasClientContacts: false,
    });
    expect(role.kind).toBe("producer-incomplete");
  });

  it("returns 'producer-complete' when producer row has displayName + custom slug", () => {
    const role = resolveUserRole({
      userId: "user_pro",
      producerRow: completeProducer,
      hasClientContacts: false,
    });
    expect(role.kind).toBe("producer-complete");
    if (role.kind === "producer-complete") {
      expect(role.producer.slug).toBe("gili-asraf");
    }
  });

  it("returns 'orphan' when no producer row AND no client_contacts (webhook race)", () => {
    // Sub-second window during Clerk webhook delivery: Clerk session
    // exists, DB rows don't yet. /onboarding wizard should still let
    // them fill the form (the action upserts idempotently).
    const role = resolveUserRole({
      userId: "user_racing",
      producerRow: null,
      hasClientContacts: false,
    });
    expect(role.kind).toBe("orphan");
  });

  it("producer-complete wins over client_contacts (producer-who-is-also-an-artist)", () => {
    // Edge case confirmed in Gili's Q&A: a producer can also be an
    // artist of another producer (collaborations). When both rows
    // exist, their PRIMARY identity is producer — they're logging
    // into their own dashboard, not someone else's artist app.
    const role = resolveUserRole({
      userId: "user_dual",
      producerRow: completeProducer,
      hasClientContacts: true,
    });
    expect(role.kind).toBe("producer-complete");
  });

  it("producer-incomplete wins over client_contacts too (dual-role mid-onboarding)", () => {
    const role = resolveUserRole({
      userId: "user_dual_mid",
      producerRow: nullNameProducer,
      hasClientContacts: true,
    });
    expect(role.kind).toBe("producer-incomplete");
  });
});
