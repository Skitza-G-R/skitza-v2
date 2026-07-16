import { describe, expect, it } from "vitest";

import { legacyBookingPaymentState, legacyCardReturnState } from "../legacy-card-containment";

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

  it("never treats a hosted-card return as payment or booking confirmation", () => {
    expect(legacyCardReturnState()).toEqual({
      kind: "card_return_unverified",
      canInitiateCardPayment: false,
      canConfirmCardPayment: false,
      canConfirmBooking: false,
      title: "Card payment cannot be confirmed here",
      explanation: "Skitza does not process card payments.",
      nextStep:
        "Ask your producer to verify whether money was received and whether the session is scheduled.",
      safetyNotice: "Opening this page did not start or change a payment or booking.",
    });
  });
});
