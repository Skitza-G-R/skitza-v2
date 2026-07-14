import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readCalendarFile = (name: string) => readFileSync(join(here, "..", name), "utf8");

const PAGE = readCalendarFile("page.tsx");
const TABS = readCalendarFile("calendar-tabs.tsx");
const SCHEDULE = readCalendarFile("schedule-panel.tsx");
const GRID = readCalendarFile("schedule-week-grid.tsx");

describe("desktop Calendar schedule and sessions merge", () => {
  it("keeps Sessions as the mobile tab and Schedule as the desktop tab", () => {
    expect(TABS).toMatch(/tab\.id === "schedule"[\s\S]*\? "hidden lg:inline-flex"/);
    expect(TABS).toMatch(/tab\.id === "sessions"[\s\S]*\? "inline-flex lg:hidden"/);
  });

  it("hydrates the merged desktop schedule for both meeting URLs", () => {
    expect(PAGE).toContain('if (active === "schedule" || active === "sessions")');
    expect(PAGE).toMatch(/<SchedulePanel[\s\S]*desktopSessions={allSessions}/);
    expect(PAGE).toMatch(
      /active === "sessions"[\s\S]*hidden min-h-0 flex-1 flex-col lg:flex[\s\S]*<SchedulePanel/,
    );
  });

  it("replaces the desktop agenda with compact sessions and one editor", () => {
    expect(SCHEDULE).toContain("ScheduleSessionsCard");
    expect(SCHEDULE).toContain("EditSessionModal");
    expect(SCHEDULE).not.toContain("ScheduleTodayAgenda");
  });

  it("makes calendar session blocks open the shared editor", () => {
    expect(GRID).toContain("onEditSession");
    expect(GRID).toMatch(/onClick=\{\(\) => \{[\s\S]*onEditSession\(session\);/);
    expect(GRID).toContain("aria-label={`Edit ${serviceLabel}");
  });

  it("uses one Edit button and a three-tab modal", () => {
    const COMPACT = readCalendarFile("schedule-sessions-card.tsx");
    const EDIT_MODAL = readCalendarFile("edit-session-modal.tsx");

    expect(COMPACT).toContain("aria-label={`Edit ${serviceLabel}");
    expect(COMPACT).toContain("<span>Edit</span>");
    expect(COMPACT).not.toContain("onSendReminder");
    expect(COMPACT).not.toContain("onCancel");

    expect(EDIT_MODAL).toContain('id: "reschedule"');
    expect(EDIT_MODAL).toContain('id: "reminder"');
    expect(EDIT_MODAL).toContain('id: "cancel"');
    expect(EDIT_MODAL).toContain("ReschedulePanel");
    expect(EDIT_MODAL).toContain("ReminderPanel");
    expect(EDIT_MODAL).toContain("CancelPanel");
  });
});
