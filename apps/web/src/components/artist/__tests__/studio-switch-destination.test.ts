import { describe, expect, it } from "vitest";

import { artistStudioSwitchHref } from "../studio-switch-destination";

describe("artistStudioSwitchHref", () => {
  it.each([
    ["/artist/store/product-1", "/artist/store"],
    ["/artist/purchase/product-1", "/artist/store"],
    ["/artist/purchase/product-1/pay/proof", "/artist/store"],
    ["/artist/offers/offer-1", "/artist/store"],
    ["/artist/payments/purchase-1", "/artist"],
    ["/artist/payments/purchase-1/proof", "/artist"],
    ["/artist/proof/payment-1", "/artist"],
    ["/artist/music/song/version-1", "/artist/music"],
    ["/artist/music/project-1", "/artist/music"],
    ["/artist/music/no-charge/proposal-1", "/artist/music"],
    ["/artist/sessions/session-1", "/artist/sessions"],
  ])("leaves resource route %s for its safe tab root", (pathname, safeRoot) => {
    expect(artistStudioSwitchHref(pathname, "studio=old&purchase=stale", "new")).toBe(
      `${safeRoot}?studio=new`,
    );
  });

  it.each(["/artist", "/artist/store", "/artist/sessions", "/artist/settings"])(
    "keeps the current safe root %s and its non-resource query",
    (pathname) => {
      expect(artistStudioSwitchHref(pathname, "view=list&studio=old", "new")).toBe(
        `${pathname}?view=list&studio=new`,
      );
    },
  );

  it("drops the Music view mode when changing studios", () => {
    expect(artistStudioSwitchHref("/artist/music", "view=all&studio=a", "b")).toBe(
      "/artist/music?studio=b",
    );
  });
});
