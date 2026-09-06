import { describe, expect, it } from "vitest";

import { isRefreshablePath } from "../refreshable-path";

describe("isRefreshablePath", () => {
  it.each([
    "/dashboard",
    "/dashboard/music",
    "/dashboard/clients-projects",
    "/dashboard/calendar",
    "/dashboard/store",
    "/dashboard/payments",
    "/dashboard/requests",
  ])("refreshes the producer main screen %s", (pathname) => {
    expect(isRefreshablePath(pathname, "producer")).toBe(true);
  });

  it.each(["/artist", "/artist/music", "/artist/sessions", "/artist/payments", "/artist/store"])(
    "refreshes the artist main screen %s",
    (pathname) => {
      expect(isRefreshablePath(pathname, "artist")).toBe(true);
    },
  );

  it.each([
    // Edit surfaces keep the elastic pull without reloading under the
    // producer mid-edit.
    "/dashboard/settings",
    "/dashboard/profile",
    "/dashboard/portfolio",
    "/dashboard/onboarding",
    // Detail pages sit below a main screen, not on it.
    "/dashboard/clients-projects/abc",
    "/dashboard/clients-projects/new",
    "/dashboard/music/version-1",
    "/dashboard/payments/proof-1",
    "/dashboard/requests/req-1",
  ])("leaves the producer screen %s un-refreshable", (pathname) => {
    expect(isRefreshablePath(pathname, "producer")).toBe(false);
  });

  it.each([
    "/artist/settings",
    "/artist/settings/studios/prod-1",
    "/artist/music/project-1",
    "/artist/sessions/session-1",
    "/artist/payments/purchase-1",
    "/artist/store/product-1",
    "/artist/offers/offer-1",
  ])("leaves the artist screen %s un-refreshable", (pathname) => {
    expect(isRefreshablePath(pathname, "artist")).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isRefreshablePath("/dashboard/music/", "producer")).toBe(true);
    expect(isRefreshablePath("/artist/sessions/", "artist")).toBe(true);
  });

  it("never crosses roles", () => {
    expect(isRefreshablePath("/artist/music", "producer")).toBe(false);
    expect(isRefreshablePath("/dashboard/music", "artist")).toBe(false);
  });
});
