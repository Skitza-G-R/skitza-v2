import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEndSlots, buildStartSlots } from "../availability-panel";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "availability-panel.tsx"), "utf-8");

// SK-264 — the Availability tab used to build windows it could not
// display (a 24:00 end with no 24:00 option renders as the first
// option, "06:00"), stack overlapping windows forever on a full day,
// and silently wipe unsaved edits whenever another preference saved.

describe("AvailabilityPanel — time select ranges", () => {
  it("offers every start slot from midnight and none at 24:00", () => {
    const slots = buildStartSlots();
    expect(slots[0]).toBe("00:00");
    expect(slots[slots.length - 1]).toBe("23:30");
    expect(slots).not.toContain("24:00");
    expect(slots).toHaveLength(48);
  });

  it("offers end slots through 24:00 so midnight windows render truthfully", () => {
    const slots = buildEndSlots();
    expect(slots[0]).toBe("00:30");
    expect(slots[slots.length - 1]).toBe("24:00");
    expect(slots).toHaveLength(48);
  });
});

describe("AvailabilityPanel — window editing safety", () => {
  it("validates each day with the shared availability rules", () => {
    expect(SRC).toContain('from "~/lib/availability/windows"');
    expect(SRC).toContain("findDayWindowsIssue");
    expect(SRC).toContain("{dayWindowsIssueMessage(");
    expect(SRC).toContain("MAX_WINDOWS_PER_DAY");
  });

  it("blocks saving while any day has an invalid window", () => {
    expect(SRC).toContain("disabled={!dirty || hasWindowIssues || isPending || !online}");
    expect(SRC).toContain("Fix the highlighted days to save.");
  });

  it("adds windows into real gaps and stops when the day is full", () => {
    expect(SRC).toContain("nextWindowSlot(");
    expect(SRC).toContain("No room left for another window on");
    expect(SRC).not.toContain("startMin = DAY_END - 60");
  });

  it("keeps unsaved working-hours edits when unrelated preferences revalidate", () => {
    expect(SRC).toContain("lastServerBlocksRef");
    expect(SRC).toMatch(/if \(sameBlocks\(lastServerBlocksRef\.current, \[\.\.\.blocks\]\)\) return;/);
  });

  it("guards Copy Mon to weekdays and confirms what it did", () => {
    expect(SRC).toContain("Set Monday's hours first.");
    expect(SRC).toContain("Copied Monday's hours to Tuesday–Friday.");
  });
});

describe("availability server actions — readable errors", () => {
  const calendarActions = readFileSync(join(here, "..", "calendar-actions.ts"), "utf-8");
  const bookingActions = readFileSync(
    join(here, "..", "..", "booking", "actions.ts"),
    "utf-8",
  );
  const bookingRouter = readFileSync(
    join(here, "..", "..", "..", "..", "..", "server", "trpc", "routers", "booking.ts"),
    "utf-8",
  );

  it("unwraps Zod causes so toasts never show raw JSON", () => {
    expect(calendarActions).toContain("cause instanceof ZodError");
    expect(bookingActions).toContain("cause instanceof ZodError");
  });

  it("enforces the shared week rules in the booking router input", () => {
    expect(bookingRouter).toContain("findWeekBlocksIssues");
    expect(bookingRouter).toMatch(/AvailabilityWeekInput[\s\S]{0,700}findWeekBlocksIssues/);
  });
});
