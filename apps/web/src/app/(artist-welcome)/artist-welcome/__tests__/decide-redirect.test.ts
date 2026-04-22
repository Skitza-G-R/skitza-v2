import { describe, it, expect } from "vitest";
import { decideArtistWelcomeRedirect } from "../decide-redirect";
import type { ProducerRow } from "~/server/auth/role";

// Guard function for `/artist-welcome` (the no-slug orphan welcome).
// Added 2026-04-22 after Gili's manual QA caught that the page had
// no role check — so an authed artist who bounced there via history
// / reload / a layout redirect still saw the "ask a producer for a
// link" copy even when their client_contacts row DID exist.
//
// Safety-net rules (pinned by these tests):
//   - unauthenticated → /sign-in (middleware should catch; defense-
//     in-depth here)
//   - artist (has client_contacts, no producer row) → /artist
//   - producer-incomplete → /onboarding
//   - producer-complete → /dashboard
//   - orphan → null (render the welcome copy — they're the only ones
//     who should see it)

const completeProducer: ProducerRow = {
  id: "p1",
  displayName: "Gili",
  slug: "gili-asraf",
  email: "gili@x.com",
};
const incompleteProducer: ProducerRow = {
  id: "p2",
  displayName: null,
  slug: "auto",
  email: "other@x.com",
};

describe("decideArtistWelcomeRedirect", () => {
  it("unauthenticated → /sign-in", () => {
    expect(decideArtistWelcomeRedirect({ kind: "unauthenticated" })).toBe(
      "/sign-in",
    );
  });

  it("🔴 CORE FIX: artist → /artist (rescues users stuck on the orphan page)", () => {
    // The critical case. Before this guard, an authed user with
    // client_contacts who landed here (via layout redirect race,
    // browser back button, reload) stayed stuck looking at the
    // orphan copy even though their account was fully provisioned.
    expect(decideArtistWelcomeRedirect({ kind: "artist" })).toBe("/artist");
  });

  it("producer-incomplete → /onboarding (wizard still needs to run)", () => {
    expect(
      decideArtistWelcomeRedirect({
        kind: "producer-incomplete",
        producer: incompleteProducer,
      }),
    ).toBe("/onboarding");
  });

  it("producer-complete → /dashboard (established producers have no business here)", () => {
    expect(
      decideArtistWelcomeRedirect({
        kind: "producer-complete",
        producer: completeProducer,
      }),
    ).toBe("/dashboard");
  });

  it("orphan → null (render welcome copy; the webhook really hasn't landed + no role)", () => {
    // The only role that should actually see the "ask a producer for
    // a link" copy. A true orphan is either a webhook-delivery
    // failure or a race window that's still open.
    expect(decideArtistWelcomeRedirect({ kind: "orphan" })).toBeNull();
  });
});
