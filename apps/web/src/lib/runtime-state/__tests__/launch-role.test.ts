import { describe, expect, it } from "vitest";

import {
  runtimeLaunchHrefForMemberships,
  runtimeLaunchHrefForRole,
} from "../launch-role";

describe("runtime launch role resolver", () => {
  it.each([
    [{ kind: "artist" as const }, "/artist"],
    [
      {
        kind: "producer-complete" as const,
        producer: {
          id: "producer-a",
          displayName: "Producer",
          slug: "producer",
          email: "producer@example.com",
        },
      },
      "/dashboard",
    ],
    [
      {
        kind: "producer-incomplete" as const,
        producer: {
          id: "producer-b",
          displayName: null,
          slug: "pending",
          email: "pending@example.com",
        },
      },
      "/onboarding",
    ],
    [{ kind: "orphan" as const }, "/onboarding"],
    [{ kind: "unauthenticated" as const }, "/sign-up"],
  ])("routes %o to %s", (role, expected) => {
    expect(runtimeLaunchHrefForRole(role)).toBe(expected);
  });

  it("keeps only a target owned by the authenticated current role", () => {
    const artist = { kind: "artist" as const };
    const producer = {
      kind: "producer-complete" as const,
      producer: {
        id: "producer-a",
        displayName: "Producer",
        slug: "producer",
        email: "producer@example.com",
      },
    };

    expect(
      runtimeLaunchHrefForRole(
        artist,
        "/artist/music?studio=studio-a&mode=songs",
      ),
    ).toBe("/artist/music?mode=songs&studio=studio-a");
    expect(runtimeLaunchHrefForRole(artist, "/dashboard/music")).toBe(
      "/artist",
    );
    expect(runtimeLaunchHrefForRole(artist, "/artist/payments")).toBe(
      "/artist",
    );
    expect(
      runtimeLaunchHrefForRole(
        producer,
        "/dashboard/clients-projects?tab=clients",
      ),
    ).toBe("/dashboard/clients-projects?tab=clients");
    expect(runtimeLaunchHrefForRole(producer, "/artist/music")).toBe(
      "/dashboard",
    );
  });
});

describe("membership-aware runtime launch resolver", () => {
  const completeProducer = {
    kind: "producer-complete" as const,
    producer: {
      id: "producer-a",
      displayName: "Producer",
      slug: "producer",
      email: "producer@example.com",
    },
  };

  it("asks a genuine dual account which safe workspace to resume", () => {
    expect(
      runtimeLaunchHrefForMemberships(
        {
          primaryRole: completeProducer,
          hasArtistAccount: true,
        },
        "/artist/music?studio=studio-a&mode=songs",
      ),
    ).toBe(
      "/choose-role?next=%2Fartist%2Fmusic%3Fmode%3Dsongs%26studio%3Dstudio-a",
    );
  });

  it("resumes a disconnected artist in the artist workspace", () => {
    expect(
      runtimeLaunchHrefForMemberships(
        {
          primaryRole: { kind: "orphan" },
          hasArtistAccount: true,
        },
        "/artist/music?mode=projects",
      ),
    ).toBe("/artist/music?mode=projects");
  });

  it("sends an unknown signed-out launch to sign-up marketing", () => {
    expect(
      runtimeLaunchHrefForMemberships({
        primaryRole: { kind: "unauthenticated" },
        hasArtistAccount: false,
      }),
    ).toBe("/sign-up");
  });

  it("carries only an allowlisted saved screen into new-user sign-up", () => {
    const unauthenticated = {
      primaryRole: { kind: "unauthenticated" as const },
      hasArtistAccount: false,
    };

    expect(
      runtimeLaunchHrefForMemberships(
        unauthenticated,
        "/dashboard/music?mode=songs&search=demo",
      ),
    ).toBe(
      "/sign-up?redirect_url=%2Fdashboard%2Fmusic%3Fmode%3Dsongs%26search%3Ddemo",
    );
    expect(
      runtimeLaunchHrefForMemberships(
        unauthenticated,
        "/artist/payments/purchase-1",
      ),
    ).toBe("/sign-up");
  });

  it("keeps a producer-only account on the producer platform", () => {
    expect(
      runtimeLaunchHrefForMemberships(
        {
          primaryRole: completeProducer,
          hasArtistAccount: false,
        },
        "/artist/music",
      ),
    ).toBe("/dashboard");
  });
});
