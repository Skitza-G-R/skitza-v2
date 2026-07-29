import { describe, expect, it } from "vitest";

import { runtimeLaunchHrefForRole } from "../launch-role";

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
    [{ kind: "unauthenticated" as const }, "/sign-in"],
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
