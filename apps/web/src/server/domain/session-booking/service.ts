export type SessionUseOutcome =
  | "reserved"
  | "completed"
  | "cancelled_on_time"
  | "cancelled_by_producer"
  | "cancelled_late"
  | "no_show";

export type SessionBookingErrorCode =
  | "PURCHASE_INACTIVE"
  | "PROJECT_INACTIVE"
  | "ALLOWANCE_CLOSED"
  | "DURATION_MISMATCH"
  | "LEAD_TIME_VIOLATION"
  | "ALLOWANCE_EXHAUSTED"
  | "INVALID_ALLOWANCE";

export class SessionBookingDomainError extends Error {
  readonly code: SessionBookingErrorCode;

  constructor(code: SessionBookingErrorCode, message: string) {
    super(message);
    this.name = "SessionBookingDomainError";
    this.code = code;
  }
}

export function sessionUseConsumesAllowance(outcome: SessionUseOutcome): boolean {
  return (
    outcome === "reserved" ||
    outcome === "completed" ||
    outcome === "cancelled_late" ||
    outcome === "no_show"
  );
}

export function assertSessionBookingAllowed(
  input: Readonly<{
    purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
    allowance: Readonly<{
      kind: "fixed" | "unlimited";
      sessionLimit: number | null;
      durationMin: number;
      minLeadHours: number;
      closedAt: Date | null;
    }>;
    existingOutcomes: readonly SessionUseOutcome[];
    requestedDurationMin: number;
    startsAt: Date;
    now: Date;
  }>,
): void {
  if (input.purchaseLifecycleStatus !== "active") {
    throw new SessionBookingDomainError(
      "PURCHASE_INACTIVE",
      "The purchase is not active for session booking",
    );
  }
  if (input.projectLifecycleStatus !== "active") {
    throw new SessionBookingDomainError(
      "PROJECT_INACTIVE",
      "The project is not active for session booking",
    );
  }
  if (input.allowance.closedAt !== null) {
    throw new SessionBookingDomainError("ALLOWANCE_CLOSED", "The session allowance is closed");
  }
  if (
    !Number.isSafeInteger(input.allowance.durationMin) ||
    input.allowance.durationMin <= 0 ||
    !Number.isSafeInteger(input.allowance.minLeadHours) ||
    input.allowance.minLeadHours < 0
  ) {
    throw new SessionBookingDomainError("INVALID_ALLOWANCE", "The session allowance is invalid");
  }
  if (input.requestedDurationMin !== input.allowance.durationMin) {
    throw new SessionBookingDomainError(
      "DURATION_MISMATCH",
      "The requested duration does not match the purchased session allowance",
    );
  }
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.now.getTime())) {
    throw new SessionBookingDomainError("INVALID_ALLOWANCE", "The session time is invalid");
  }
  const earliestStart = input.now.getTime() + input.allowance.minLeadHours * 60 * 60 * 1000;
  if (input.startsAt.getTime() < earliestStart) {
    throw new SessionBookingDomainError(
      "LEAD_TIME_VIOLATION",
      "The session does not meet the purchased minimum lead time",
    );
  }

  if (input.allowance.kind === "unlimited") {
    if (input.allowance.sessionLimit !== null) {
      throw new SessionBookingDomainError(
        "INVALID_ALLOWANCE",
        "An unlimited allowance cannot have a fixed limit",
      );
    }
    return;
  }

  if (
    !Number.isSafeInteger(input.allowance.sessionLimit) ||
    input.allowance.sessionLimit === null ||
    input.allowance.sessionLimit <= 0
  ) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "A fixed allowance must have a positive limit",
    );
  }
  const used = input.existingOutcomes.filter(sessionUseConsumesAllowance).length;
  if (used >= input.allowance.sessionLimit) {
    throw new SessionBookingDomainError(
      "ALLOWANCE_EXHAUSTED",
      "No purchased sessions remain on this allowance",
    );
  }
}
