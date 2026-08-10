import { describe, expect, it } from "vitest";

import {
  replayedGoogleCalendarProtection,
  reviewedFinalGoogleCalendarProtection,
} from "./booking-protection";

describe("manual booking Google Calendar protection", () => {
  it("requires a fresh warning review when a healthy preview degrades at the final check", () => {
    expect(
      reviewedFinalGoogleCalendarProtection({
        protection: "google_aware",
        acknowledgedReducedGoogleProtection: false,
      }),
    ).toBe("active");

    expect(() =>
      reviewedFinalGoogleCalendarProtection({
        protection: "skitza_only",
        acknowledgedReducedGoogleProtection: false,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "GOOGLE_CALENDAR_PROTECTION_REVIEW_REQUIRED",
      }),
    );
  });

  it("keeps fail-open booking available after the reduced-protection warning is reviewed", () => {
    expect(
      reviewedFinalGoogleCalendarProtection({
        protection: "skitza_only",
        acknowledgedReducedGoogleProtection: true,
      }),
    ).toBe("reduced");
  });

  it("reports a lost-response replay conservatively from its immutable acknowledgement", () => {
    expect(replayedGoogleCalendarProtection(false)).toBe("active");
    expect(replayedGoogleCalendarProtection(true)).toBe("reduced");
  });
});
