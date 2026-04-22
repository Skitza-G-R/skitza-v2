import { describe, it, expect } from "vitest";
import { decideAppLayoutRedirect } from "../decide-redirect";
import { emailToSlug } from "~/lib/slug";

// Unit tests for the pure routing-decision function used by the (app)
// layout. Extracted from the layout so we can assert the policy
// without mocking Clerk + Drizzle + next/navigation.
//
// The critical case is "artist-with-client_contacts" — the 2026-04-22
// bug was that this branch didn't exist, so artists who self-served
// via /join/<slug> got funneled into Producer Onboarding. See
// docs/audit-report.md Task 15.

describe("decideAppLayoutRedirect", () => {
  it("returns '/sign-in' when there's no authenticated user", () => {
    expect(
      decideAppLayoutRedirect({
        userId: null,
        producerRow: null,
        hasClientContacts: false,
      }),
    ).toBe("/sign-in");
  });

  it("returns '/artist' when user has NO producers row but HAS client_contacts — artists who joined via /join", () => {
    // ⚠️ Critical regression guard: this is the 2026-04-22 bug fix.
    // Before the fix, an authed user with no producers row went to
    // /onboarding (producer onboarding). After the fix, if they have
    // client_contacts rows they're clearly an artist → /artist.
    expect(
      decideAppLayoutRedirect({
        userId: "user_artist_1",
        producerRow: null,
        hasClientContacts: true,
      }),
    ).toBe("/artist");
  });

  it("returns '/onboarding' when no producer row and no client_contacts (webhook race or rare orphan)", () => {
    // This path is hit only briefly: (a) between Clerk user.created
    // firing and the webhook landing — measured in hundreds of ms —
    // or (b) a user whose webhook failed entirely. Sending them to
    // /onboarding is fine: the onboarding action itself gates on the
    // producer row existing, so it silently waits for the webhook
    // to catch up. Better than hanging them on a dead page.
    expect(
      decideAppLayoutRedirect({
        userId: "user_new",
        producerRow: null,
        hasClientContacts: false,
      }),
    ).toBe("/onboarding");
  });

  it("returns '/onboarding' when producers row exists but displayName is null (incomplete)", () => {
    expect(
      decideAppLayoutRedirect({
        userId: "user_1",
        producerRow: {
          displayName: null,
          slug: "gili-abcd",
          email: "gili@x.com",
        },
        hasClientContacts: false,
      }),
    ).toBe("/onboarding");
  });

  it("returns '/onboarding' when slug is still the email-derived auto-slug", () => {
    // A completed displayName alone isn't "done" — the producer hasn't
    // picked their public slug yet, so the wizard still needs to run.
    expect(
      decideAppLayoutRedirect({
        userId: "user_1",
        producerRow: {
          displayName: "Gili",
          slug: emailToSlug("gili@x.com"),
          email: "gili@x.com",
        },
        hasClientContacts: false,
      }),
    ).toBe("/onboarding");
  });

  it("returns null (no redirect — render dashboard) for a complete producer", () => {
    expect(
      decideAppLayoutRedirect({
        userId: "user_1",
        producerRow: {
          displayName: "Gili Asraf",
          slug: "gili-asraf",
          email: "gili@x.com",
        },
        hasClientContacts: false,
      }),
    ).toBeNull();
  });

  it("producer-who-is-also-an-artist: complete producer row wins over client_contacts (render dashboard)", () => {
    // Edge case: Gili is a producer, but another producer also
    // invited him to collaborate → he has a client_contacts row too.
    // He's logging into HIS dashboard, not anyone else's artist app,
    // so the complete producer row must win.
    expect(
      decideAppLayoutRedirect({
        userId: "user_gili",
        producerRow: {
          displayName: "Gili Asraf",
          slug: "gili-asraf",
          email: "gili@x.com",
        },
        hasClientContacts: true,
      }),
    ).toBeNull();
  });
});
