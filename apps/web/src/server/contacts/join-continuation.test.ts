import { describe, expect, it } from "vitest";

import {
  isSelfJoin,
  joinArtistHref,
  joinBookingHref,
  joinEntryMode,
  type JoinTargetProducer,
} from "./join-continuation";

const target: JoinTargetProducer = {
  id: "producer-target",
  clerkUserId: "owner-user",
  displayName: "Northline Studio",
  slug: "northline-studio",
};

describe("join continuation security", () => {
  it("blocks a Producer from joining their own public page", () => {
    expect(isSelfJoin("owner-user", target)).toBe(true);
    expect(isSelfJoin("different-user", target)).toBe(false);
  });

  it("continues the requested action directly in the target studio", () => {
    expect(joinBookingHref(target)).toBe(
      "/artist/book?studio=producer-target",
    );
    expect(joinArtistHref(target)).toBe("/artist?studio=producer-target");
  });

  it("keeps new and returning Artists on the direct booking path", () => {
    expect(
      joinEntryMode({
        isAuthenticated: true,
        producer: { status: "none", profile: null },
        artist: { hasAccess: false, hasActiveConnections: false },
      }),
    ).toBe("direct");
    expect(
      joinEntryMode({
        isAuthenticated: true,
        producer: { status: "none", profile: null },
        artist: { hasAccess: true, hasActiveConnections: true },
      }),
    ).toBe("direct");
  });

  it.each(["complete", "incomplete"] as const)(
    "requires the approved confirmation for a %s Producer",
    (status) => {
      expect(
        joinEntryMode({
          isAuthenticated: true,
          producer: {
            status,
            profile: {
              id: "producer-self",
              displayName: status === "complete" ? "Producer" : null,
              slug: "producer-self",
              email: "producer@example.com",
            },
          },
          artist: { hasAccess: true, hasActiveConnections: true },
        }),
      ).toBe("producer-confirmation");
    },
  );
});
