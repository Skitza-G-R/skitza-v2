import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "availability-step-client.tsx"), "utf8");
const weekStartSource = readFileSync(
  join(here, "..", "..", "..", "..", "..", "lib", "time", "week-start.ts"),
  "utf8",
);

describe("onboarding availability truthfulness", () => {
  it("shows only the working-hours preferences that Continue actually saves", () => {
    expect(source).not.toContain("Auto-confirm");
    expect(source).not.toContain("Buffer");
    expect(source).not.toContain("Cancellation");
    expect(source).not.toContain("Google Calendar");
    expect(source).not.toContain("Coming soon");
    expect(source).not.toContain("TODO(persist-settings)");
  });

  it("describes this step as working hours instead of unsaved rules", () => {
    expect(source).toContain("Set your working hours. You approve every booking request.");
    expect(source).not.toContain("Set your hours and rules.");
  });

  it("names every weekday switch, uses 44px controls, and respects reduced motion", () => {
    expect(source).toContain("aria-label={`${WEEKDAY_NAMES[day.weekday]} availability`}");
    expect(source).toContain("h-11 w-11");
    expect(source.match(/motion-reduce:transition-none/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders only one copy-hours control per active day", () => {
    expect(source.match(/copyToAllDays\(day\.weekday\)/g)).toHaveLength(1);
    expect(source).toContain("day.active && activeDayCount > 1");
  });

  it("saves only on Continue and lets Skip leave suggestions unsaved", () => {
    expect(source).toContain("useOnlineStatus");
    expect(source).toContain("const saveAndContinue = () => {");
    expect(source).toContain("if (!online)");
    expect(source).toContain('toast("Reconnect to save availability.", "error")');
    expect(source).toMatch(
      /startTransition\(async \(\) => \{\s*try \{\s*const res = await setAvailabilityWeek/,
    );
    expect(source).toContain('toast("Could not save availability. Try again.", "error")');
    expect(source).toContain('previewMode ? "/onboarding/welcome?__preview=1"');
    expect(source).toContain(": routeOnSkipFromAvailability()");
    expect(source).not.toContain("advance(routeOnSkipFromAvailability())");
    expect(source).toContain("saveAndContinue");
  });

  it("keeps the no-write preview week-start toggle local", () => {
    expect(source).toMatch(/useWeekStartPref\([\s\S]*!previewMode/);
    expect(weekStartSource).toContain("if (!persist) return;");
  });

  it("labels the default weekday pattern as an unsaved suggestion", () => {
    expect(source).toMatch(/Suggested hours/i);
    expect(source).toMatch(/not saved until you continue/i);
  });
});
