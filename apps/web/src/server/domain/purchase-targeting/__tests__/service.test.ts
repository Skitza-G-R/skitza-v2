import { describe, expect, it } from "vitest";

import { assertPurchaseTargetCanChange, PurchaseTargetingError } from "../service";

describe("purchase targeting policy", () => {
  it.each(["pending", "approved"] as const)("allows correction while %s", (status) => {
    expect(() => {
      assertPurchaseTargetCanChange({ status, hasAcceptedPurchase: false });
    }).not.toThrow();
  });

  it.each(["declined", "canceled", "converted"] as const)(
    "locks a %s request",
    (status) => {
      expect(() => {
        assertPurchaseTargetCanChange({ status, hasAcceptedPurchase: false });
      }).toThrow(PurchaseTargetingError);
    },
  );

  it("locks the target as soon as accepted purchase history exists", () => {
    expect(() => {
      assertPurchaseTargetCanChange({ status: "approved", hasAcceptedPurchase: true });
    }).toThrow(/acceptance or payment history/i);
  });
});
