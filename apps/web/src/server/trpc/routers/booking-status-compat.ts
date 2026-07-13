import type { Booking } from "@skitza/db";

/**
 * The production database may still return the legacy `pending` label until
 * SK-79 is migrated. Keep reads compatible without hiding that real booking.
 */
export function normalizePersistedBookingStatus(status: string): Booking["status"] {
  return status === "pending" ? "pending_approval" : (status as Booking["status"]);
}
