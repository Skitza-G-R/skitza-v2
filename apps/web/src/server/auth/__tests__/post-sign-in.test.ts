import { describe, expect, it } from "vitest";

import type {
  ProducerRow,
  UserAccountMemberships,
} from "../role";
import {
  chosenRoleDestination,
  joinSignUpHrefFromTarget,
  joinSignUpMetadataFromTarget,
  normalizeSameOriginPostSignInTarget,
  postSignInDestination,
  postSignInResolverHref,
  postSignUpResolverHref,
  sanitizePostSignInTarget,
  trustedAuthRequestOrigin,
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
      "/join/studio-slug/continue?action=home",
      {
        href: "/join/studio-slug/continue?action=home",
        platform: "artist",
      },
    ],
    [
      "/join/studio-slug/continue?action=store",
      {
        href: "/join/studio-slug/continue?action=store",
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

describe("postSignUpResolverHref", () => {
  it("sends only a successful normal-invite signup to the validated Store continuation", () => {
    expect(
      postSignUpResolverHref(
        "/join/northline-studio/continue?action=home",
      ),
    ).toBe(
      "/auth/resolve?next=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dstore",
    );

    expect(
      postSignInResolverHref(
        "/join/northline-studio/continue?action=home",
      ),
    ).toBe(
      "/auth/resolve?next=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dhome",
    );
  });

  it.each(["book", "unlock"])(
    "keeps the explicit %s signup route unchanged",
    (action) => {
      const target = `/join/northline-studio/continue?action=${action}`;
      expect(postSignUpResolverHref(target)).toBe(
        postSignInResolverHref(target),
      );
    },
  );

  it("drops an invalid Producer context instead of constructing a destination", () => {
    expect(
      postSignUpResolverHref(
        "/join/Invalid/continue?action=home",
      ),
    ).toBe("/auth/resolve");
    expect(
      postSignUpResolverHref(
        "https://evil.example/join/northline-studio/continue?action=home",
      ),
    ).toBe("/auth/resolve");
  });
});

describe("joinSignUpMetadataFromTarget", () => {
  it("derives Artist metadata only from a strictly validated join continuation", () => {
    expect(
      joinSignUpMetadataFromTarget(
        "/join/northline-studio/continue?action=book",
      ),
    ).toEqual({ signupOrigin: "join", producerSlug: "northline-studio" });
    expect(
      joinSignUpMetadataFromTarget(
        "/join/northline-studio/continue?action=unlock",
      ),
    ).toEqual({ signupOrigin: "join", producerSlug: "northline-studio" });
    expect(
      joinSignUpMetadataFromTarget(
        "/join/northline-studio/continue?action=home",
      ),
    ).toEqual({ signupOrigin: "join", producerSlug: "northline-studio" });
    expect(
      joinSignUpMetadataFromTarget(
        "/join/northline-studio/continue?action=store",
      ),
    ).toEqual({ signupOrigin: "join", producerSlug: "northline-studio" });
  });

  it.each([
    "/join/ab/continue?action=book",
    "/join/northline-studio/continue?action=delete",
    "/join/northline-studio/continue?action=book&next=/dashboard",
    "https://evil.example/join/northline-studio/continue?action=book",
    "/dashboard",
  ])("does not stamp OAuth signup metadata for unsafe target %s", (target) => {
    expect(joinSignUpMetadataFromTarget(target)).toBeNull();
  });
});

describe("joinSignUpHrefFromTarget", () => {
  it("marks Book, Unlock, and Home switches as explicit account creation", () => {
    expect(
      joinSignUpHrefFromTarget(
        "/join/northline-studio/continue?action=book",
      ),
    ).toBe("/sign-up/join/northline-studio?intent=signup");
    expect(
      joinSignUpHrefFromTarget(
        "/join/northline-studio/continue?action=unlock",
      ),
    ).toBe("/sign-up/join/northline-studio/unlock?intent=signup");
    expect(
      joinSignUpHrefFromTarget(
        "/join/northline-studio/continue?action=home",
      ),
    ).toBe("/sign-up/join/northline-studio/home?intent=signup");
    expect(
      joinSignUpHrefFromTarget(
        "/join/northline-studio/continue?action=store",
      ),
    ).toBe("/sign-up/join/northline-studio/home?intent=signup");
  });
});

describe("same-origin Clerk transfer targets", () => {
  it("normalizes Clerk's absolute same-origin join target back to the strict relative contract", () => {
    const origin = trustedAuthRequestOrigin({
      forwardedHost: "preview.example.test",
      forwardedProto: "https",
      host: "internal.invalid",
    });
    const normalized = normalizeSameOriginPostSignInTarget(
      "https://preview.example.test/join/northline-studio/continue?action=book",
      origin,
    );

    expect(normalized).toBe(
      "/join/northline-studio/continue?action=book",
    );
    expect(joinSignUpMetadataFromTarget(normalized)).toEqual({
      signupOrigin: "join",
      producerSlug: "northline-studio",
    });
  });

  it.each([
    "https://evil.example/join/northline-studio/continue?action=book",
    "https://preview.example.test@evil.example/join/northline-studio/continue?action=book",
    "https://preview.example.test/join/northline-studio/continue?action=book#unsafe",
  ])("rejects a non-equivalent absolute transfer target %s", (target) => {
    expect(
      normalizeSameOriginPostSignInTarget(
        target,
        "https://preview.example.test",
      ),
    ).toBeNull();
  });

  it("rejects malformed forwarded request origins", () => {
    expect(
      trustedAuthRequestOrigin({
        forwardedHost: "preview.example.test@evil.example",
        forwardedProto: "https",
        host: null,
      }),
    ).toBeNull();
  });
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
