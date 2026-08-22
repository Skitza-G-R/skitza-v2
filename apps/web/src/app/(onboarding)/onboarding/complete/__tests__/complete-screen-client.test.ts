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

  it("offers active-work import as an optional next step without sending anything", () => {
    const dashboardAction = SRC.indexOf("Open dashboard");
    const importAction = SRC.indexOf("Bring in your active work");

    expect(dashboardAction).toBeGreaterThan(-1);
    expect(importAction).toBeGreaterThan(dashboardAction);
    expect(SRC).toContain('href="/dashboard/clients-projects/bring-active-work"');
    expect(SRC).toContain("Add the clients and projects you already started.");
    expect(SRC).toContain("Nothing will be sent to anyone.");
    expect(SRC).toContain("Add active work");
  });
});
