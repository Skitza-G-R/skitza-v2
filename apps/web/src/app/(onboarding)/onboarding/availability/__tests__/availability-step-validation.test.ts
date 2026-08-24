import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "availability-step-client.tsx"), "utf8");

// SK-264 — the onboarding step used to disable Continue with no
// explanation when a time range was wrong, allowed overlapping windows
// (which the server then rejected with an unreadable error), and capped
// windows at 3 per day while the Calendar tab allowed unlimited.

describe("onboarding availability validation feedback", () => {
  it("uses the shared availability rules instead of local ones", () => {
    expect(source).toContain('from "~/lib/availability/windows"');
    expect(source).toContain("findDayWindowsIssue");
    expect(source).toContain("MAX_WINDOWS_PER_DAY");
    expect(source).toContain("nextWindowSlot(");
  });

  it("shows the reason a day is invalid right under its windows", () => {
    expect(source).toContain("{dayWindowsIssueMessage(");
  });

  it("explains the disabled Continue when every day is off", () => {
    expect(source).toContain("Turn on at least one day so artists can book you.");
  });

  it("caps windows per day with the shared limit, not a local 3", () => {
    expect(source).toContain("day.windows.length < MAX_WINDOWS_PER_DAY");
    expect(source).not.toContain("d.windows.length >= 3");
    expect(source).not.toContain("day.windows.length < 3");
  });

  it("still gates Continue on validity", () => {
    expect(source).toContain("continueDisabled={!hoursAreValid}");
  });
});
