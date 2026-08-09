import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const bookingRouter = readFileSync(join(here, "..", "booking.ts"), "utf8");
const listStart = bookingRouter.lastIndexOf("  list: producerProcedure");
const listEnd = bookingRouter.indexOf("\n\n  confirm: producerProcedure", listStart);
const bookingList = bookingRouter.slice(listStart, listEnd);
const statusEnum = bookingList.match(/status:\s*z\s*\.enum\(\[([\s\S]*?)\]\)/)?.[1] ?? "";

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
      expect(statusEnum).toContain(`"${status}"`);
    }
    expect(statusEnum).not.toContain('"pending"');
    expect(statusEnum).not.toContain('"pending_payment"');
    expect(bookingList).not.toContain("normalizePersistedBookingStatus");
  });

  it("uses the enum column directly while preserving producer ownership", () => {
    expect(bookingList).toContain("eq(bookings.status, input.status)");
    expect(bookingList).toContain("eq(bookings.producerId, ctx.producerId)");
    expect(bookingList).not.toContain("bookings.status}::text");
  });

  it("optionally bounds the read to one producer-owned project", () => {
    expect(bookingList).toContain("projectId: z.string().uuid().optional()");
    expect(bookingList).toContain("eq(bookings.projectId, input.projectId)");
    expect(bookingList).toMatch(
      /and\(\s*eq\(bookings\.producerId, ctx\.producerId\),[\s\S]*?eq\(bookings\.projectId, input\.projectId\)/,
    );
  });

  it("joins the purchase on purchase, project, and producer identity", () => {
    expect(bookingList).toMatch(
      /\.innerJoin\(\s*purchases,\s*and\(\s*eq\(purchases\.id, bookings\.purchaseId\),\s*eq\(purchases\.projectId, bookings\.projectId\),\s*eq\(purchases\.producerId, bookings\.producerId\),/,
    );
    expect(bookingList).toContain("purchases.commercialSnapshot");
    expect(bookingList).toContain('purchaseProductName(commercialSnapshot, "Session")');
  });
});
