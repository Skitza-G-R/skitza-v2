import { describe, expect, it } from "vitest";

import { appRouter } from "../_app";

describe("legacy booking payment confirmation containment", () => {
  it("does not expose an unauthenticated confirmAfterPayment procedure", () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain("booking.confirmAfterPayment");
  });

  it("does not expose confirmed booking metadata by supplied UUID", () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain("booking.getConfirmedBooking");
  });
});
