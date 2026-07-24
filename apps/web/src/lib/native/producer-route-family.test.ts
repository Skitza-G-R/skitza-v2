import { describe, expect, it } from "vitest";

import { producerRouteFamily } from "./producer-route-family";

describe("producer native route matrix", () => {
  it.each([
    ["/dashboard", "today"],
    ["/dashboard/calendar", "calendar"],
    ["/dashboard/clients-projects", "workspace"],
    ["/dashboard/clients-projects/new", "workspace"],
    ["/dashboard/clients-projects/project-a", "workspace"],
    ["/dashboard/clients-projects/project-a/songs/song-a", "workspace"],
    ["/dashboard/clients-projects/clients/client-a", "workspace"],
    ["/dashboard/music", "music"],
    ["/dashboard/music/version-a", "music"],
    ["/dashboard/music/project/project-a", "music"],
    ["/dashboard/payments", "payments"],
    ["/dashboard/payments/proof-a", "payments"],
    ["/dashboard/portfolio", "portfolio"],
    ["/dashboard/profile", "settings"],
    ["/dashboard/requests", "requests"],
    ["/dashboard/requests/request-a", "requests"],
    ["/dashboard/settings", "settings"],
    ["/dashboard/store", "store"],
    ["/dashboard/onboarding", "onboarding"],
  ] as const)("maps %s to %s", (pathname, family) => {
    expect(producerRouteFamily(pathname)).toBe(family);
  });

  it.each([
    "/dashboard/invented",
    "/dashboard/music/project",
    "/dashboard/clients-projects/clients",
    "/artist",
    "/listen/token",
  ])("does not invent a producer family for %s", (pathname) => {
    expect(producerRouteFamily(pathname)).toBeNull();
  });
});
