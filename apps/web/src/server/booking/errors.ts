export type SessionBookingErrorCode =
  | "PURCHASE_INACTIVE"
  | "PROJECT_INACTIVE"
  | "ALLOWANCE_CLOSED"
  | "DURATION_MISMATCH"
  | "LEAD_TIME_VIOLATION"
  | "ALLOWANCE_EXHAUSTED"
  | "BILLING_TREATMENT_INVALID"
  | "INVALID_ALLOWANCE"
  | "INVALID_SLOT"
  | "OUTSIDE_AVAILABILITY"
  | "BLACKOUT"
  | "BOOKING_CONFLICT"
  | "BUFFER_CONFLICT"
  | "DAILY_LIMIT"
  | "WARNING_ACKNOWLEDGEMENT_REQUIRED"
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "CANCELLATION_WINDOW"
  | "OPERATION_KEY_CONFLICT"
  | "BOOKING_DISABLED"
  | "HELD_EXPIRED"
  | "TOO_EARLY";

export class SessionBookingDomainError extends Error {
  readonly code: SessionBookingErrorCode;

  constructor(code: SessionBookingErrorCode, message: string) {
    super(message);
    this.name = "SessionBookingDomainError";
    this.code = code;
  }
}
