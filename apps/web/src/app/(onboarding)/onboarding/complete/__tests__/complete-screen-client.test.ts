import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "complete-screen-client.tsx"), "utf8");

describe("onboarding completion Store discovery", () => {
  it("opens the dashboard with the one-time Store cue", () => {
    expect(SRC).toContain('export const COMPLETE_DASHBOARD_HREF = "/dashboard?storeTip=1"');
    expect(SRC).toContain("href={COMPLETE_DASHBOARD_HREF}");
    expect(SRC).toContain("Open dashboard");
  });

  it("offers active-work import with honest reminder copy", () => {
    const dashboardAction = SRC.indexOf("Open dashboard");
    const importAction = SRC.indexOf("Bring in your active work");

    expect(dashboardAction).toBeGreaterThan(-1);
    expect(importAction).toBeGreaterThan(dashboardAction);
    expect(SRC).toContain('href="/dashboard/clients-projects/bring-active-work"');
    expect(SRC).toContain("Add the clients and projects you already started.");
    expect(SRC).not.toContain("Nothing will be sent to anyone.");
    expect(SRC).toMatch(/Nothing is sent while you set\s+things up\./);
    expect(SRC).toMatch(/Reminders turn on for unpaid payments only when you finish setup\./);
    expect(SRC).toContain("Add active work");
  });

  it("promotes active work above the optional grid, and keeps the skip visible", () => {
    // SK-299: real artists and real money are the point of the first minute,
    // so this stopped being one card among the optional ones.
    const activeWork = SRC.indexOf('aria-labelledby="active-work-heading"');
    const optional = SRC.indexOf('aria-labelledby="optional-next-steps-heading"');

    expect(activeWork).toBeGreaterThan(-1);
    expect(optional).toBeGreaterThan(-1);
    expect(activeWork).toBeLessThan(optional);
    // It is never a trap: the skip is always on screen and lands on the dashboard.
    expect(SRC).toContain("I&apos;ll do this later");
    expect(SRC.indexOf("I&apos;ll do this later")).toBeLessThan(optional);
  });
});
