import { describe, expect, it } from "vitest";

import {
  formatRoyaltyPercentage,
  royaltyTermsDisplay,
} from "../royalty-terms";

describe("royalty term display", () => {
  it("round-trips basis points without losing decimal precision", () => {
    expect(formatRoyaltyPercentage(1)).toBe("0.01%");
    expect(formatRoyaltyPercentage(250)).toBe("2.5%");
    expect(formatRoyaltyPercentage(1250)).toBe("12.5%");
    expect(formatRoyaltyPercentage(10_000)).toBe("100%");
  });

  it("renders legacy null terms safely", () => {
    expect(royaltyTermsDisplay(null)).toEqual({
      specified: false,
      master: "Not specified",
      composition: "Not specified",
    });
  });

  it("includes optional composition context only when present", () => {
    expect(
      royaltyTermsDisplay({
        master: { mode: "none" },
        composition: {
          mode: "percentage",
          bps: 250,
          role: "composer",
          collectingSociety: "ACUM",
        },
      }),
    ).toEqual({
      specified: true,
      master: "No master royalty",
      composition: "2.5% composition royalty · Composer · ACUM",
    });

    expect(
      royaltyTermsDisplay({
        master: { mode: "agreement" },
        composition: { mode: "percentage", bps: 1 },
      }).composition,
    ).toBe("0.01% composition royalty");
  });
});
