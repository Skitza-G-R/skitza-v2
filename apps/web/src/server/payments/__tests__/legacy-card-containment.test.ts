import { describe, expect, it } from "vitest";

import { legacyBookingPaymentState } from "../legacy-card-containment";

describe("legacy booking card containment", () => {
  it("always returns a fail-closed off-app state", () => {
    expect(legacyBookingPaymentState("North Studio")).toEqual({
      kind: "card_payment_unavailable",
      canInitiateCardPayment: false,
      title: "Card payment is unavailable",
      offAppInstructions:
        "Ask North Studio for their bank or other off-app payment instructions before sending money.",
      safetyNotice: "No card payment will be started from this page.",
    });
  });

  it("does not produce an unsafe empty payee instruction", () => {
    expect(legacyBookingPaymentState("   ").offAppInstructions).toContain("Ask your producer");
  });
});
