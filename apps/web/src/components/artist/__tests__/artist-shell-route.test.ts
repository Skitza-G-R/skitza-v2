import { describe, expect, it } from "vitest";

import { getArtistShellMode } from "../artist-shell-route";

describe("getArtistShellMode", () => {
  it.each([
    "/artist/book",
    "/artist/book/",
    "/artist/purchase/product-1/agree",
    "/artist/purchase/product-1/request",
    "/artist/purchase/product-1/sent",
    "/artist/purchase/product-1/pay",
    "/artist/purchase/product-1/pay/instructions",
    "/artist/purchase/product-1/pay/proof",
    "/artist/payments/purchase-1/instructions",
    "/artist/payments/purchase-1/proof/new",
    "/artist/payments/purchase-1/proof/proof-1",
    "/artist/sessions/session-1/cancel",
    "/artist/sessions/session-1/reschedule",
    "/artist/settings/account/delete",
  ])("marks %s as focused", (pathname) => {
    expect(getArtistShellMode(pathname)).toBe("focused");
  });

  it.each([
    "/artist",
    "/artist/music",
    "/artist/sessions",
    "/artist/sessions/session-1",
    "/artist/store",
    "/artist/purchase/product-1",
    "/artist/purchase/product-1/unknown",
    "/artist/book/unknown",
    "/artist/sessions/session-1/cancel/extra",
    "/artist/payments",
    "/artist/payments/purchase-1",
    "/artist/settings",
    "/artist/not-found",
  ])("keeps %s in the standing shell", (pathname) => {
    expect(getArtistShellMode(pathname)).toBe("standing");
  });
});
