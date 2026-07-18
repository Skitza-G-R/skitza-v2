import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const bookingRouter = readFileSync(join(here, "..", "booking.ts"), "utf8");
const listStart = bookingRouter.lastIndexOf("  list: producerProcedure");
const listEnd = bookingRouter.indexOf("\n\n  confirm: producerProcedure", listStart);
const bookingList = bookingRouter.slice(listStart, listEnd);

describe("canonical booking list status and purchase projection", () => {
  it("accepts only canonical persisted booking statuses", () => {
    for (const status of [
      "pending_approval",
      "confirmed",
      "rejected",
      "cancelled",
      "completed",
      "no_show",
    ]) {
      expect(bookingList).toContain(`"${status}"`);
    }
    expect(bookingList).not.toContain('"pending"');
    expect(bookingList).not.toContain('"pending_payment"');
    expect(bookingList).not.toContain("normalizePersistedBookingStatus");
  });

  it("uses the enum column directly while preserving producer ownership", () => {
    expect(bookingList).toContain("eq(bookings.status, input.status)");
    expect(bookingList).toContain("eq(bookings.producerId, ctx.producerId)");
    expect(bookingList).not.toContain("bookings.status}::text");
  });

  it("joins the purchase on purchase, project, and producer identity", () => {
    expect(bookingList).toMatch(
      /\.innerJoin\(\s*purchases,\s*and\(\s*eq\(purchases\.id, bookings\.purchaseId\),\s*eq\(purchases\.projectId, bookings\.projectId\),\s*eq\(purchases\.producerId, bookings\.producerId\),/,
    );
    expect(bookingList).toContain("purchases.commercialSnapshot");
    expect(bookingList).toContain('purchaseProductName(commercialSnapshot, "Session")');
  });
});
