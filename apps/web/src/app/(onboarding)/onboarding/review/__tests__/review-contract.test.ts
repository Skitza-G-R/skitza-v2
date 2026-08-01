import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "review-step-client.tsx"), "utf8");
const bookingSource = readFileSync(
  join(here, "..", "..", "..", "..", "..", "server", "trpc", "routers", "booking.ts"),
  "utf8",
);

describe("onboarding final review", () => {
  it("uses the real artist preview and publishes only at the final action", () => {
    expect(source).toContain("<ArtistProductPreview");
    expect(source).toContain("setPackageActive");
    expect(source).toContain("active: true");
    expect(source).toContain("requireAvailability: true");
    expect(source).toContain('continueLabel="Publish page"');
  });

  it("re-checks required availability under the shared schedule lock when publishing", () => {
    expect(bookingSource).toContain("input.active && input.requireAvailability");
    expect(bookingSource).toContain("existing.bookingEnabled");
    expect(bookingSource).toContain("sessionBookingScheduleAdvisoryLockKey(ctx.producerId)");
    expect(bookingSource).toContain(".from(availabilityBlocks)");
    expect(bookingSource).toContain("Add working hours before publishing this product.");
  });

  it("states the external-payment boundary plainly", () => {
    expect(source).toMatch(/Payments stay\s+outside Skitza/);
    expect(source).not.toMatch(/pay in one tap|Skitza handles/);
  });

  it("marks working hours not needed for non-session products", () => {
    expect(source).toContain("this product has no bookable sessions");
    expect(source).toContain("hoursNotNeeded={hoursNotNeeded}");
  });

  it("uses the persisted booking flag for review navigation and artist preview", () => {
    expect(source).toContain("bookingEnabled={product.bookingEnabled}");
    expect(source).toContain(
      'product.bookingEnabled ? "/onboarding/availability" : "/onboarding/service"',
    );
  });
});
