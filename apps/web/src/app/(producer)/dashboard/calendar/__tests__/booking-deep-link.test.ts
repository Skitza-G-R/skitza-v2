import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveCalendarTabForBooking } from "../calendar-tab-key";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "..", "page.tsx"), "utf8");
const PENDING = readFileSync(
  join(here, "..", "schedule-pending-card.tsx"),
  "utf8",
);
const SESSIONS = readFileSync(join(here, "..", "sessions-panel.tsx"), "utf8");

describe("Calendar booking deep link", () => {
  it("keeps pending requests on the actionable Schedule surface", () => {
    expect(resolveCalendarTabForBooking(undefined, "pending_approval")).toBe(
      "schedule",
    );
  });

  it.each(["pending_payment", "confirmed", "rejected", "cancelled"] as const)(
    "opens %s bookings on the selectable Sessions surface",
    (status) => {
      expect(resolveCalendarTabForBooking(undefined, status)).toBe("sessions");
    },
  );

  it("respects an explicit valid tab", () => {
    expect(resolveCalendarTabForBooking("availability", "confirmed")).toBe(
      "availability",
    );
  });

  it("parses ?booking= through a tenant-scoped current-status lookup", () => {
    expect(PAGE).toMatch(/booking\?: string \| string\[\]/);
    expect(PAGE).toContain("await caller.booking.list()");
    expect(PAGE).toContain("resolveCalendarTabForBooking(");
    expect(PAGE).toMatch(/<SchedulePendingCard[\s\S]*selectedBookingId=/);
    expect(PAGE).toMatch(/<SessionsPanel[\s\S]*selectedBookingId=/);
  });

  it("visibly selects and focuses a pending request", () => {
    expect(PENDING).toContain('data-selected={selected ? "true" : "false"}');
    expect(PENDING).toContain("scrollIntoView");
    expect(PENDING).toContain("focus({ preventScroll: true })");
  });

  it("selects confirmed or past bookings in the sessions list", () => {
    expect(SESSIONS).toContain("selectedIsPast");
    expect(SESSIONS).toContain('setFilter(selectedIsPast ? "past" : "upcoming")');
    expect(SESSIONS).toContain("data-selected=");
  });

  it("does not send a selected pending id to both mobile copies", () => {
    expect(PAGE).toContain(
      "selectedBookingIsPending ? null : selectedBookingId",
    );
  });

  it("uses the 64px producer topbar geometry without the retired margin", () => {
    expect(PAGE).toContain("lg:h-[calc(100dvh-64px)]");
    expect(PAGE).not.toContain("lg:h-[calc(100dvh-40px)]");
    expect(PAGE).not.toMatch(/className="[^"]*\bmt-10\b/);
  });
});
