import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizePersistedBookingStatus } from "../booking-status-compat";

const here = dirname(fileURLToPath(import.meta.url));
const bookingRouter = readFileSync(join(here, "..", "booking.ts"), "utf8");

describe("legacy booking-status compatibility", () => {
  it("normalizes the old pending label without changing current labels", () => {
    expect(normalizePersistedBookingStatus("pending")).toBe("pending_approval");
    expect(normalizePersistedBookingStatus("pending_approval")).toBe("pending_approval");
    expect(normalizePersistedBookingStatus("pending_payment")).toBe("pending_payment");
    expect(normalizePersistedBookingStatus("confirmed")).toBe("confirmed");
  });

  it("filters list reads as text while keeping producer ownership", () => {
    expect(bookingRouter).toMatch(
      /input\?\.status === "pending_approval"[\s\S]*?bookings\.status\}::text IN \('pending', 'pending_approval'\)/,
    );
    expect(bookingRouter).toMatch(
      /eq\(bookings\.producerId, ctx\.producerId\)[\s\S]*?statusFilter/,
    );
    expect(bookingRouter).toContain("normalizePersistedBookingStatus(row.status)");
  });
});
