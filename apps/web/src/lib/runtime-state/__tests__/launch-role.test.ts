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
    [{ kind: "orphan" as const }, "/producer-access"],
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
    id: "producer-a",
    displayName: "Producer",
    slug: "producer",
    email: "producer@example.com",
  };

  it("lets an explicit role target override the saved role for a dual account", () => {
    expect(
      runtimeLaunchHrefForMemberships(
        {
          isAuthenticated: true,
          producer: { status: "complete", profile: completeProducer },
          artist: { hasAccess: true, hasActiveConnections: true },
        },
        "/artist/music?studio=studio-a&mode=songs",
      ),
    ).toBe("/artist/music?mode=songs&studio=studio-a");
  });

  it("uses the client-side last-role resolver when a dual account has no explicit target", () => {
    expect(
      runtimeLaunchHrefForMemberships({
        isAuthenticated: true,
        producer: { status: "complete", profile: completeProducer },
        artist: { hasAccess: true, hasActiveConnections: true },
      }),
    ).toBe("/auth/resume");
  });

  it("resumes a disconnected artist in the artist workspace", () => {
    expect(
      runtimeLaunchHrefForMemberships(
        {
          isAuthenticated: true,
          producer: { status: "none", profile: null },
          artist: { hasAccess: true, hasActiveConnections: false },
        },
        "/artist/music?mode=projects",
      ),
    ).toBe("/artist/music?mode=projects");
  });

  it("sends an unknown signed-out launch to sign-up marketing", () => {
    expect(
      runtimeLaunchHrefForMemberships({
        isAuthenticated: false,
        producer: { status: "none", profile: null },
        artist: { hasAccess: false, hasActiveConnections: false },
      }),
    ).toBe("/sign-up");
  });

  it("sends a signed-in account without a role to Producer invitation information", () => {
    expect(
      runtimeLaunchHrefForMemberships({
        isAuthenticated: true,
        producer: { status: "none", profile: null },
        artist: { hasAccess: false, hasActiveConnections: false },
      }),
    ).toBe("/producer-access");
  });

  it("carries only an allowlisted saved screen into new-user sign-up", () => {
    const unauthenticated = {
      isAuthenticated: false,
      producer: { status: "none" as const, profile: null },
      artist: { hasAccess: false, hasActiveConnections: false },
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
          isAuthenticated: true,
          producer: { status: "complete", profile: completeProducer },
          artist: { hasAccess: false, hasActiveConnections: false },
        },
        "/artist/music",
      ),
    ).toBe("/dashboard");
  });
});
