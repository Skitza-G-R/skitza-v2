import { SessionBookingDomainError } from "~/server/booking";

export type PublicGoogleCalendarProtection = "active" | "reduced";

export const REDUCED_PROTECTION_REVIEW_MESSAGE =
  "Google Calendar availability could not be checked. Review the reduced-protection warning before saving.";

/**
 * The provider check immediately before a manual write is authoritative. A
 * newly degraded check may still fail open, but only after the producer has
 * explicitly reviewed that reduced-protection state.
 */
export function reviewedFinalGoogleCalendarProtection(
  input: Readonly<{
    protection: "google_aware" | "skitza_only";
    acknowledgedReducedGoogleProtection: boolean;
  }>,
): PublicGoogleCalendarProtection {
  if (input.protection === "skitza_only" && !input.acknowledgedReducedGoogleProtection) {
    throw new SessionBookingDomainError(
      "GOOGLE_CALENDAR_PROTECTION_REVIEW_REQUIRED",
      REDUCED_PROTECTION_REVIEW_MESSAGE,
    );
  }
  return input.protection === "google_aware" ? "active" : "reduced";
}

/**
 * No provider call is made for an idempotent replay. The acknowledgement is
 * part of the immutable operation digest, so a reviewed command is reported
 * conservatively as reduced instead of falsely claiming active protection.
 */
export function replayedGoogleCalendarProtection(
  acknowledgedReducedGoogleProtection: boolean,
): PublicGoogleCalendarProtection {
  return acknowledgedReducedGoogleProtection ? "reduced" : "active";
}
