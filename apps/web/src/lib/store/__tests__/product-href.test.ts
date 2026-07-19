import { describe, expect, it } from "vitest";

import { productHref } from "../product-href";

describe("productHref", () => {
  it("routes every pricing model into the unified purchase funnel", () => {
    expect(productHref({ id: "p1", pricingModel: "flat" })).toBe("/artist/purchase/p1");
    expect(productHref({ id: "p2", pricingModel: "bundle" })).toBe("/artist/purchase/p2");
    expect(productHref({ id: "p3", pricingModel: "hourly" })).toBe("/artist/purchase/p3");
    expect(productHref({ id: "p4", pricingModel: "per_song" })).toBe("/artist/purchase/p4");
  });
});
