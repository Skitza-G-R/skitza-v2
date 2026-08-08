import { SessionBookingDomainError } from "./errors";
import { minimumLeadTimeSatisfied } from "./time";
import type { SessionBookingBillingTreatment, SessionUseOutcome } from "./types";

export function sessionUseConsumesAllowance(
  outcome: SessionUseOutcome,
  billingTreatment: SessionBookingBillingTreatment = "included",
): boolean {
  if (billingTreatment !== "included") return false;
  return (
    outcome === "reserved" ||
    outcome === "completed" ||
    outcome === "cancelled_late" ||
    outcome === "no_show"
  );
}

export type SessionAllowanceUse = Readonly<{
  allowanceUseId: string;
  outcome: SessionUseOutcome;
  billingTreatment?: SessionBookingBillingTreatment;
}>;

export type SessionBillingOptions = Readonly<{
  remainingIncluded: number | null;
  defaultTreatment: "included" | null;
  allowedTreatments: readonly SessionBookingBillingTreatment[];
}>;

export function sessionBillingOptions(
  input: Readonly<{
    allowanceKind: "fixed" | "unlimited";
    sessionLimit: number | null;
    existingUses: readonly SessionAllowanceUse[];
  }>,
): SessionBillingOptions {
  const usedIncluded = new Set(
    input.existingUses
      .filter((use) => sessionUseConsumesAllowance(use.outcome, use.billingTreatment ?? "included"))
      .map((use) => use.allowanceUseId),
  ).size;

  if (input.allowanceKind === "unlimited") {
    if (input.sessionLimit !== null) {
      throw new SessionBookingDomainError(
        "INVALID_ALLOWANCE",
        "An unlimited allowance cannot have a fixed limit",
      );
    }
    return {
      remainingIncluded: null,
      defaultTreatment: "included",
      allowedTreatments: ["included", "complimentary"],
    };
  }

  if (
    input.sessionLimit === null ||
    !Number.isSafeInteger(input.sessionLimit) ||
    input.sessionLimit <= 0
  ) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "A fixed allowance must have a positive limit",
    );
  }
  const remainingIncluded = Math.max(0, input.sessionLimit - usedIncluded);
  return remainingIncluded > 0
    ? {
        remainingIncluded,
        defaultTreatment: "included",
        allowedTreatments: ["included", "complimentary"],
      }
    : {
        remainingIncluded: 0,
        defaultTreatment: null,
        allowedTreatments: ["complimentary", "billable_extra"],
      };
}

export function sessionAllowanceCanBook(input: {
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  allowanceClosedAt: Date | null;
  bookingEnabledSnapshot?: boolean;
  allowanceKind: "fixed" | "unlimited";
  sessionLimit: number | null;
  billingTreatmentMode?: "choose" | "preserve";
  existingOutcomes?: readonly SessionUseOutcome[];
  existingUses?: readonly SessionAllowanceUse[];
}): boolean {
  if (
    input.purchaseLifecycleStatus !== "active" ||
    input.projectLifecycleStatus !== "active" ||
    input.allowanceClosedAt !== null ||
    input.bookingEnabledSnapshot === false
  ) {
    return false;
  }
  if (input.allowanceKind === "unlimited") return input.sessionLimit === null;
  if (input.sessionLimit === null || input.sessionLimit <= 0) return false;
  if (input.billingTreatmentMode === "preserve") return true;
  const used =
    input.existingUses === undefined
      ? (input.existingOutcomes ?? []).filter((outcome) => sessionUseConsumesAllowance(outcome))
          .length
      : new Set(
          input.existingUses
            .filter((use) =>
              sessionUseConsumesAllowance(use.outcome, use.billingTreatment ?? "included"),
            )
            .map((use) => use.allowanceUseId),
        ).size;
  return used < input.sessionLimit;
}

export function assertSessionBookingAllowed(
  input: Readonly<{
    purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
    projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
    allowance: Readonly<{
      bookingEnabledSnapshot: boolean;
      kind: "fixed" | "unlimited";
      sessionLimit: number | null;
      durationMin: number;
      minLeadHours: number;
      closedAt: Date | null;
    }>;
    existingOutcomes: readonly SessionUseOutcome[];
    existingUses?: readonly SessionAllowanceUse[];
    billingTreatment?: SessionBookingBillingTreatment;
    billingTreatmentMode?: "choose" | "preserve";
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
  if (!input.allowance.bookingEnabledSnapshot) {
    throw new SessionBookingDomainError(
      "BOOKING_DISABLED",
      "This purchase does not include artist session booking",
    );
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
  if (
    !minimumLeadTimeSatisfied({
      startsAt: input.startsAt,
      now: input.now,
      minLeadHours: input.allowance.minLeadHours,
    })
  ) {
    throw new SessionBookingDomainError(
      "LEAD_TIME_VIOLATION",
      "The session does not meet the purchased minimum lead time",
    );
  }

  if ((input.billingTreatmentMode ?? "choose") === "preserve") return;

  const billingTreatment = input.billingTreatment ?? "included";
  const billing = sessionBillingOptions({
    allowanceKind: input.allowance.kind,
    sessionLimit: input.allowance.sessionLimit,
    existingUses:
      input.existingUses ??
      input.existingOutcomes.map((outcome, index) => ({
        allowanceUseId: `legacy-${String(index)}`,
        outcome,
        billingTreatment: "included" as const,
      })),
  });
  if (!billing.allowedTreatments.includes(billingTreatment)) {
    if (billingTreatment === "included") {
      throw new SessionBookingDomainError(
        "ALLOWANCE_EXHAUSTED",
        "No purchased sessions remain on this allowance",
      );
    }
    throw new SessionBookingDomainError(
      "BILLING_TREATMENT_INVALID",
      billingTreatment === "billable_extra"
        ? "Billable extra is available only after the included allowance is exhausted"
        : "The selected billing treatment is not available",
    );
  }
}
