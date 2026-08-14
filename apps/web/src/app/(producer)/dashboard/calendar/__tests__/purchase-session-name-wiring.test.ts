import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const calendarPage = readFileSync(join(here, "..", "page.tsx"), "utf8");
const dashboardPage = readFileSync(join(here, "..", "..", "page.tsx"), "utf8");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("project-owned session names", () => {
  it("uses project names in every calendar projection without changing desktop UI wiring", () => {
    expect(calendarPage).not.toMatch(/packageName: "Session"/);

    const desktopPending = between(
      calendarPage,
      "  const pendingRequests:",
      "  const mobilePendingRequests:",
    );
    const desktopSchedule = between(
      calendarPage,
      "  const scheduleSessions:",
      "  const scheduleMobileSessions:",
    );
    const mobileSchedule = between(
      calendarPage,
      "  const scheduleMobileSessions:",
      "  const allSessions:",
    );
    const desktopSessions = between(
      calendarPage,
      "  const allSessions:",
      "  const mobileAllSessions:",
    );
    const mobileSessions = between(
      calendarPage,
      "  const mobileAllSessions:",
      "  const initialNow",
    );

    expect(desktopPending).toContain("packageName: b.projectName");
    expect(desktopSchedule.match(/packageName: b\.projectName/g)).toHaveLength(2);
    expect(desktopSessions).toContain("packageName: b.projectName");
    expect(desktopSessions).toContain("title: b.title ?? b.packageNameSnapshot");
    expect(desktopSessions).toContain("kindSource: b.title ?? b.packageNameSnapshot");

    expect(mobileSchedule.match(/packageName: b\.projectName/g)).toHaveLength(2);
    expect(mobileSchedule).toContain("title: b.title ?? b.packageNameSnapshot");
    expect(mobileSchedule).toContain(
      "title: full?.title ?? full?.packageNameSnapshot ?? b.packageName",
    );
    expect(mobileSessions).toContain("packageName: b.projectName");
    expect(mobileSessions).toContain("title: b.title ?? b.packageNameSnapshot");
    expect(calendarPage).toContain("initial={mobilePendingRequests}");
    expect(calendarPage).toContain("desktopSessions={allSessions}");
    expect(calendarPage).toContain("sessions={mobileAllSessions}");
  });

  it("preserves the purchase-derived name in dashboard pending approvals", () => {
    expect(dashboardPage).toMatch(/packageNameSnapshot: booking\.packageNameSnapshot/);
    expect(dashboardPage).not.toMatch(/packageNameSnapshot: "Session"/);
  });
});
