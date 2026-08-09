import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readCalendarFile = (name: string) => readFileSync(join(here, "..", name), "utf8");

const PAGE = readCalendarFile("page.tsx");
const TABS = readCalendarFile("calendar-tabs.tsx");
const SWIPE = readCalendarFile("calendar-swipe-surface.tsx");
const SCHEDULE = readCalendarFile("schedule-panel.tsx");
const GRID = readCalendarFile("schedule-week-grid.tsx");
const COMPACT = readCalendarFile("schedule-sessions-card.tsx");

describe("desktop Calendar schedule and sessions merge", () => {
  it("keeps Sessions as the mobile tab and Schedule as the desktop tab", () => {
    expect(TABS).toMatch(/tab\.id === "schedule"[\s\S]*\? "hidden lg:inline-flex"/);
    expect(TABS).toMatch(/tab\.id === "sessions"[\s\S]*\? "inline-flex lg:hidden"/);
  });

  it("swipes across the two distinct responsive calendar surfaces", () => {
    expect(PAGE).toContain("<CalendarSwipeSurface");
    expect(SWIPE).toContain('["sessions", "availability"]');
    expect(SWIPE).toContain('active === "availability" ? "availability" : "sessions"');
    expect(SWIPE).toContain("useTabSwipe");
    expect(SWIPE).toContain("data-tab-swipe-surface");
    expect(SWIPE).toContain("[touch-action:pan-y_pinch-zoom]");
    expect(SWIPE).toContain("{ scroll: false }");
  });

  it("hydrates the merged desktop schedule for both meeting URLs", () => {
    expect(PAGE).toMatch(
      /Promise\.all\(\[[\s\S]*caller\.booking\.list\(\)[\s\S]*caller\.booking\.upcoming\([\s\S]*caller\.booking\.availability\.getSettings\(\)[\s\S]*caller\.booking\.availability\.list\(\)[\s\S]*caller\.booking\.blackouts\.list\(\)/,
    );
    expect(PAGE).toMatch(/<SchedulePanel[\s\S]*desktopSessions={allSessions}/);
    expect(PAGE).toMatch(
      /sessionsContent=\{[\s\S]*hidden min-h-0 flex-1 flex-col lg:flex[\s\S]*<SchedulePanel/,
    );
    expect(PAGE).toContain("availabilityContent={");
  });

  it("uses compact read-only sessions without a fake editor", () => {
    expect(SCHEDULE).toContain("ScheduleSessionsCard");
    expect(SCHEDULE).not.toContain("EditSessionModal");
    expect(SCHEDULE).not.toContain("ScheduleTodayAgenda");
  });

  it("lets the sessions list use the full available desktop rail height", () => {
    expect(COMPACT).toContain("flex min-h-0 flex-1 flex-col overflow-hidden");
    expect(COMPACT).not.toContain("max-h-[360px]");
  });

  it("keeps session filters at a safe touch size below desktop", () => {
    expect(COMPACT).toContain("h-11");
    expect(COMPACT).toContain("lg:h-7");
  });

  it("routes deliberate calendar double-clicks to the real reschedule flow", () => {
    expect(GRID).toContain("onDoubleClick");
    expect(GRID).toContain("onRescheduleSession");
    expect(SCHEDULE).toContain("RescheduleSessionModal");
    expect(SCHEDULE).not.toContain("EditSessionModal");
    expect(GRID).not.toContain("aria-label={`Edit ${serviceLabel}");
  });

  it("removes fake edit and reminder controls while keeping real cancellation", () => {
    expect(COMPACT).not.toContain("aria-label={`Edit ${serviceLabel}");
    expect(COMPACT).not.toContain("<span>Edit</span>");
    expect(COMPACT).not.toContain("onEdit");
    expect(COMPACT).not.toContain("onSendReminder");
    expect(COMPACT).toContain("CancelSessionModal");
    expect(COMPACT).toContain("onCancel");
    expect(SCHEDULE).not.toContain("EditSessionModal");
  });
});
