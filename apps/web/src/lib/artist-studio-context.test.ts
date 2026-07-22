import { describe, expect, it } from "vitest";

import { resolveArtistStudioId, withArtistStudio } from "./artist-studio-context";

const studios = [{ producerId: "studio-a" }, { producerId: "studio-b" }] as const;

describe("artist studio URL context", () => {
  it("keeps a requested studio when it belongs to the artist", () => {
    expect(resolveArtistStudioId(studios, "studio-b")).toBe("studio-b");
  });

  it("falls back to the first studio for a missing or stale selection", () => {
    expect(resolveArtistStudioId(studios, null)).toBe("studio-a");
    expect(resolveArtistStudioId(studios, "removed-studio")).toBe("studio-a");
    expect(resolveArtistStudioId([], "removed-studio")).toBeNull();
  });

  it("adds the selected studio to every artist destination", () => {
    expect(withArtistStudio("/artist", "studio-b")).toBe("/artist?studio=studio-b");
    expect(withArtistStudio("/artist/music", "studio-b")).toBe("/artist/music?studio=studio-b");
    expect(withArtistStudio("/artist/book", "studio-b")).toBe("/artist/book?studio=studio-b");
    expect(withArtistStudio("/artist/payments", "studio-b")).toBe(
      "/artist/payments?studio=studio-b",
    );
  });

  it("preserves existing query parameters and hashes while replacing studio", () => {
    expect(withArtistStudio("/artist/book?project=p1#slots", "studio-b")).toBe(
      "/artist/book?project=p1&studio=studio-b#slots",
    );
    expect(withArtistStudio("/artist/store?studio=studio-a", "studio-b")).toBe(
      "/artist/store?studio=studio-b",
    );
  });

  it("does not invent a studio parameter for an artist with no studios", () => {
    expect(withArtistStudio("/artist", null)).toBe("/artist");
  });

  it("keeps one trusted studio through a complete purchase and payment journey", () => {
    const studioId = "studio-b";
    const paths = [
      "/artist/store",
      "/artist/purchase/product-1",
      "/artist/purchase/product-1/sent?req=request-1",
      "/artist/purchase/product-1/pay?req=request-1",
      "/artist/purchase/product-1/agree?req=request-1&plan=full",
      "/artist/purchase/product-1/pay/instructions?purchase=purchase-1",
      "/artist/purchase/product-1/pay/proof?purchase=purchase-1&installment=installment-1",
      "/artist/payments/purchase-1",
      "/artist",
    ];

    for (const path of paths) {
      const href = withArtistStudio(path, studioId);
      expect(new URL(href, "https://skitza.test").searchParams.get("studio")).toBe(studioId);
    }
  });
});
