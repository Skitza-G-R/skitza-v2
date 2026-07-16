export type LegacyBookingPaymentState = Readonly<{
  kind: "card_payment_unavailable";
  canInitiateCardPayment: false;
  title: string;
  offAppInstructions: string;
  safetyNotice: string;
}>;

export type LegacyCardReturnState = Readonly<{
  kind: "card_return_unverified";
  canInitiateCardPayment: false;
  canConfirmCardPayment: false;
  canConfirmBooking: false;
  title: string;
  explanation: string;
  nextStep: string;
  safetyNotice: string;
}>;

/**
 * Fail-closed policy for the legacy booking payment route.
 *
 * The unauthenticated Tranzila confirmation callback is disabled, so starting
 * a card charge would take money without activating the booking. Until the
 * legacy flow is removed by the wider payment work, callers can only present
 * the producer's off-app payment path.
 */
export function legacyBookingPaymentState(producerName: string): LegacyBookingPaymentState {
  const payee = producerName.trim() || "your producer";

  return {
    kind: "card_payment_unavailable",
    canInitiateCardPayment: false,
    title: "Card payment is unavailable",
    offAppInstructions: `Ask ${payee} for their bank or other off-app payment instructions before sending money.`,
    safetyNotice: "No card payment will be started from this page.",
  };
}

/**
 * Fail-closed state for a return from a legacy hosted-card URL.
 *
 * The return URL is not evidence that money moved or a booking changed. It
 * must stay read-only and direct the artist back to the producer for the
 * actual off-app payment and session status.
 */
export function legacyCardReturnState(): LegacyCardReturnState {
  return {
    kind: "card_return_unverified",
    canInitiateCardPayment: false,
    canConfirmCardPayment: false,
    canConfirmBooking: false,
    title: "Card payment cannot be confirmed here",
    explanation: "Skitza does not process card payments.",
    nextStep:
      "Ask your producer to verify whether money was received and whether the session is scheduled.",
    safetyNotice: "Opening this page did not start or change a payment or booking.",
  };
}
