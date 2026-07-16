export type LegacyBookingPaymentState = Readonly<{
  kind: "card_payment_unavailable";
  canInitiateCardPayment: false;
  title: string;
  offAppInstructions: string;
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
