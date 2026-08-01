import { describe, expect, it } from "vitest";

import type {
  ProducerRow,
  UserAccountMemberships,
} from "../role";
import {
  chosenRoleDestination,
  postSignInDestination,
  postSignInResolverHref,
  sanitizePostSignInTarget,
} from "../post-sign-in";

const completeProducer: ProducerRow = {
  id: "producer-complete",
  displayName: "Complete Producer",
  slug: "complete-producer",
  email: "complete@example.com",
};

const incompleteProducer: ProducerRow = {
  id: "producer-incomplete",
  displayName: null,
  slug: "pending",
  email: "pending@example.com",
};

const artistOnly: UserAccountMemberships = {
  isAuthenticated: true,
  producer: { status: "none", profile: null },
  artist: { hasAccess: true, hasActiveConnections: true },
};

const producerOnly: UserAccountMemberships = {
  isAuthenticated: true,
  producer: { status: "complete", profile: completeProducer },
  artist: { hasAccess: false, hasActiveConnections: false },
};

const dualRole: UserAccountMemberships = {
  isAuthenticated: true,
  producer: { status: "complete", profile: completeProducer },
  artist: { hasAccess: true, hasActiveConnections: true },
};

const incompleteDualRole: UserAccountMemberships = {
  isAuthenticated: true,
  producer: { status: "incomplete", profile: incompleteProducer },
  artist: { hasAccess: true, hasActiveConnections: true },
};

describe("sanitizePostSignInTarget", () => {
  it.each([
    [
      "/artist/music/song/version-1?studio=studio-a&from=mail",
      {
        href: "/artist/music/song/version-1?studio=studio-a&from=mail",
        platform: "artist",
      },
    ],
    [
      "/artist/payments/purchase-1/proof?return=%2Fartist%2Fpayments",
      {
        href:
          "/artist/payments/purchase-1/proof?return=%2Fartist%2Fpayments",
        platform: "artist",
      },
    ],
    [
      "/artist-welcome/studio-slug",
      {
        href: "/artist-welcome/studio-slug",
        platform: "artist",
      },
    ],
    [
      "/join/studio-slug/continue?action=book",
      {
        href: "/join/studio-slug/continue?action=book",
        platform: "artist",
      },
    ],
    [
      "/join/studio-slug/continue?action=unlock",
      {
        href: "/join/studio-slug/continue?action=unlock",
        platform: "artist",
      },
    ],
    [
      "/dashboard/clients-projects/project-1?song=song-1",
      {
        href: "/dashboard/clients-projects/project-1?song=song-1",
        platform: "producer",
      },
    ],
    [
      "/onboarding/studio",
      {
        href: "/onboarding/studio",
        platform: "producer",
      },
    ],
    [
      "/projects/project-1?tab=files",
      {
        href: "/projects/project-1?tab=files",
        platform: "producer",
      },
    ],
    [
      "/settings/billing?from=renewal",
      {
        href: "/settings/billing?from=renewal",
        platform: "producer",
      },
    ],
  ])("preserves the same-site app target %s", (raw, expected) => {
    expect(sanitizePostSignInTarget(raw)).toEqual(expected);
  });

  it.each([
    "https://evil.example/artist",
    "//evil.example/artist",
    "/\\evil.example/artist",
    "/artist/../../sign-in",
    "/sign-in",
    "/auth/resolve",
    "/choose-role",
    "/artist-lookalike",
    "/dashboard-lookalike",
    "/",
    "",
  ])("rejects unsafe or non-platform target %s", (raw) => {
    expect(sanitizePostSignInTarget(raw)).toBeNull();
  });

  it("rejects an unbounded target", () => {
    expect(
      sanitizePostSignInTarget(`/artist?search=${"a".repeat(2100)}`),
    ).toBeNull();
  });
});

describe("postSignInResolverHref", () => {
  it("nests a safe deep link under the authenticated resolver", () => {
    expect(
      postSignInResolverHref("/artist/music/song/version-1?studio=studio-a"),
    ).toBe(
      "/auth/resolve?next=%2Fartist%2Fmusic%2Fsong%2Fversion-1%3Fstudio%3Dstudio-a",
    );
  });

  it("drops an unsafe deep link", () => {
    expect(postSignInResolverHref("https://evil.example/artist")).toBe(
      "/auth/resolve",
    );
  });

  it("keeps the producer slug and booking action for join-origin sign-in", () => {
    expect(
      postSignInResolverHref("/join/studio-slug/continue?action=book"),
    ).toBe(
      "/auth/resolve?next=%2Fjoin%2Fstudio-slug%2Fcontinue%3Faction%3Dbook",
    );
  });

  it.each(["---", "-studio", "studio-", "s".repeat(48)])(
    "accepts persisted public-slug boundary %s",
    (slug) => {
      expect(
        postSignInResolverHref(`/join/${slug}/continue?action=book`),
      ).toContain(encodeURIComponent(`/join/${slug}/continue?action=book`));
    },
  );

  it.each(["ab", "s".repeat(49), "Studio", "studio/other"])(
    "rejects an invalid join slug %s",
    (slug) => {
      expect(
        postSignInResolverHref(`/join/${slug}/continue?action=book`),
      ).toBe("/auth/resolve");
    },
  );
});

describe("postSignInDestination", () => {
  it("preserves a matching artist deep link", () => {
    expect(
      postSignInDestination(
        artistOnly,
        "/artist/music/song/version-1?studio=studio-a",
      ),
    ).toBe("/artist/music/song/version-1?studio=studio-a");
  });

  it("preserves a matching producer deep link", () => {
    expect(
      postSignInDestination(
        producerOnly,
        "/dashboard/clients-projects/project-1?song=song-1",
      ),
    ).toBe("/dashboard/clients-projects/project-1?song=song-1");
  });

  it("drops a cross-role deep link for a single-role account", () => {
    expect(postSignInDestination(artistOnly, "/dashboard/music")).toBe(
      "/artist",
    );
    expect(postSignInDestination(producerOnly, "/artist/music")).toBe(
      "/dashboard",
    );
  });

  it("routes an incomplete producer to onboarding", () => {
    expect(
      postSignInDestination(
        {
          isAuthenticated: true,
          producer: { status: "incomplete", profile: incompleteProducer },
          artist: { hasAccess: false, hasActiveConnections: false },
        },
        "/dashboard/music",
      ),
    ).toBe("/onboarding");
  });

  it("routes a webhook-race orphan to onboarding", () => {
    expect(
      postSignInDestination(
        {
          isAuthenticated: true,
          producer: { status: "none", profile: null },
          artist: { hasAccess: false, hasActiveConnections: false },
        },
        null,
      ),
    ).toBe("/onboarding");
  });

  it("keeps a disconnected artist account on the artist platform", () => {
    expect(
      postSignInDestination(
        {
          isAuthenticated: true,
          producer: { status: "none", profile: null },
          artist: { hasAccess: true, hasActiveConnections: false },
        },
        null,
      ),
    ).toBe("/artist");
  });

  it("lets an explicit Artist deep link override Producer precedence", () => {
    expect(
      postSignInDestination(
        dualRole,
        "/artist/music/song/version-1?studio=studio-a",
      ),
    ).toBe("/artist/music/song/version-1?studio=studio-a");
  });

  it("keeps Artist mode usable while Producer setup is unfinished", () => {
    expect(
      postSignInDestination(
        incompleteDualRole,
        "/artist/book?studio=producer-target",
      ),
    ).toBe("/artist/book?studio=producer-target");
  });

  it("preserves only the exact Create-a-studio action for an Artist after sign-in", () => {
    expect(
      postSignInDestination(
        artistOnly,
        "/onboarding/studio?intent=create-studio",
      ),
    ).toBe("/onboarding/studio?intent=create-studio");
    expect(
      postSignInDestination(
        artistOnly,
        "/onboarding/studio?intent=create-studio&next=/dashboard",
      ),
    ).toBe("/artist");
    expect(postSignInDestination(artistOnly, "/onboarding/studio")).toBe(
      "/artist",
    );
  });

  it("preserves join intent for a Producer so the join route can ask for confirmation", () => {
    expect(
      postSignInDestination(
        producerOnly,
        "/join/studio-slug/continue?action=book",
      ),
    ).toBe("/join/studio-slug/continue?action=book");
  });

  it("preserves the intended target when an unauthenticated resolver is revisited", () => {
    expect(
      postSignInDestination(
        {
          isAuthenticated: false,
          producer: { status: "none", profile: null },
          artist: { hasAccess: false, hasActiveConnections: false },
        },
        "/artist/music",
      ),
    ).toBe("/sign-in?redirect_url=%2Fartist%2Fmusic");
  });
});

describe("chosenRoleDestination", () => {
  it("preserves only a deep link owned by the chosen role", () => {
    expect(
      chosenRoleDestination(
        dualRole,
        "artist",
        "/artist/music/song/version-1?studio=studio-a",
      ),
    ).toBe("/artist/music/song/version-1?studio=studio-a");
    expect(
      chosenRoleDestination(dualRole, "producer", "/artist/music"),
    ).toBe("/dashboard");
    expect(
      chosenRoleDestination(
        dualRole,
        "producer",
        "/dashboard/clients-projects/project-1",
      ),
    ).toBe("/dashboard/clients-projects/project-1");
  });

  it("sends an incomplete dual-role producer choice to onboarding", () => {
    expect(
      chosenRoleDestination(
        {
          isAuthenticated: true,
          producer: { status: "incomplete", profile: incompleteProducer },
          artist: { hasAccess: true, hasActiveConnections: true },
        },
        "producer",
        "/dashboard/music",
      ),
    ).toBe("/onboarding");
  });

  it("refuses a role the account does not own", () => {
    expect(
      chosenRoleDestination(artistOnly, "producer", "/dashboard/music"),
    ).toBe("/artist");
    expect(
      chosenRoleDestination(producerOnly, "artist", "/artist/music"),
    ).toBe("/dashboard");
  });

  it("does not trust an impossible artist flag without an authenticated identity", () => {
    expect(
      chosenRoleDestination(
        {
          isAuthenticated: false,
          producer: { status: "none", profile: null },
          artist: { hasAccess: true, hasActiveConnections: true },
        },
        "artist",
        "/artist/music",
      ),
    ).toBe("/sign-in?redirect_url=%2Fartist%2Fmusic");
  });
});
